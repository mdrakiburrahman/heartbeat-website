# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "cccccccc-3333-3333-3333-cccccccccccc",
# META       "default_lakehouse_name": "heartbeat_lakehouse",
# META       "default_lakehouse_workspace_id": "00000000-0000-0000-0000-000000000000",
# META       "known_lakehouses": [
# META         {
# META           "id": "cccccccc-3333-3333-3333-cccccccccccc"
# META         }
# META       ]
# META     }
# META   }
# META }

# MARKDOWN ********************

# # 💚 Heartbeat — Stateful Stream Processing
# 
# This notebook implements **stateful heartbeat monitoring** using Spark Structured Streaming with RocksDB state store.
# 
# ### Architecture
# ```
# 🌐 Browser (heartbeat-website)
#     ↓ sends heartbeats
# 📥 Producer EventStream (Custom Endpoint Source)
#     ↓ default stream
# 📤 Producer EventStream (Custom Endpoint Sink)
#     ↓ Spark reads
# ⚡ THIS NOTEBOOK — Stateful Processing (RocksDB)
#     ↓ Spark writes health state
# 📥 Consumer EventStream (Custom Endpoint Source)
#     ↓ default stream
# 📤 Consumer EventStream (Custom Endpoint Sink)
#     ↓
# 🌐 Browser reads health status
# ```
# 
# ### How It Works
# - Heartbeat events arrive from producers (browser-based)
# - Spark groups by `machine_name` and tracks state transitions:
#   - `None → Initializing → Healthy ↔ Unhealthy (on 5s timeout)`
# - Only emits output when state **changes** (not every heartbeat)
# - Uses **RocksDB** as the state store for efficient stateful processing

# CELL ********************

# ============================================================================
# Cell 1: Discover EventStream Connection Strings
# ============================================================================
# This cell uses the Fabric REST API to automatically retrieve the Event Hub
# connection strings from the Producer and Consumer EventStreams.
# No manual copy-paste of connection strings is needed.

import json
import requests

workspace_id = notebookutils.runtime.context["currentWorkspaceId"]
fabric_token = notebookutils.credentials.getToken("https://api.fabric.microsoft.com")

headers = {
    "Authorization": f"Bearer {fabric_token}",
    "Content-Type": "application/json",
}

base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

# Get all items in the workspace
items_response = requests.get(f"{base_url}/items", headers=headers)
items_response.raise_for_status()
items = items_response.json()["value"]

# Find the Producer and Consumer EventStreams
producer_es = next((i for i in items if i["displayName"] == "heartbeat_producer" and i["type"] == "Eventstream"), None)
consumer_es = next((i for i in items if i["displayName"] == "heartbeat_consumer" and i["type"] == "Eventstream"), None)

if not producer_es or not consumer_es:
    raise ValueError(
        "Could not find heartbeat_producer and/or heartbeat_consumer EventStreams in this workspace. "
        "Please ensure the Jumpstart was installed correctly."
    )

print(f"✅ Found Producer EventStream: {producer_es['id']}")
print(f"✅ Found Consumer EventStream: {consumer_es['id']}")

def get_eventstream_connections(es_id, es_name):
    """Get source and destination connection strings for an EventStream."""
    topology_url = f"{base_url}/eventstreams/{es_id}/topology"
    topology_response = requests.get(topology_url, headers=headers)
    topology_response.raise_for_status()
    topology = topology_response.json()

    connections = {}

    # Get source connection (write endpoint)
    for source in topology.get("sources", []):
        if source["type"] == "CustomEndpoint":
            source_url = f"{base_url}/eventstreams/{es_id}/sources/{source['id']}/connection"
            conn_response = requests.get(source_url, headers=headers)
            conn_response.raise_for_status()
            conn_data = conn_response.json()
            connections["source"] = conn_data["accessKeys"]["primaryConnectionString"]
            print(f"  📥 {es_name} Source (write): {conn_data['fullyQualifiedNamespace']}")

    # Get destination connection (read endpoint)
    for dest in topology.get("destinations", []):
        if dest["type"] == "CustomEndpoint":
            dest_url = f"{base_url}/eventstreams/{es_id}/destinations/{dest['id']}/connection"
            conn_response = requests.get(dest_url, headers=headers)
            conn_response.raise_for_status()
            conn_data = conn_response.json()
            connections["destination"] = conn_data["accessKeys"]["primaryConnectionString"]
            print(f"  📤 {es_name} Sink (read):  {conn_data['fullyQualifiedNamespace']}")

    return connections

print("\n🔍 Retrieving Producer EventStream connections...")
producer_conns = get_eventstream_connections(producer_es["id"], "Producer")

print("\n🔍 Retrieving Consumer EventStream connections...")
consumer_conns = get_eventstream_connections(consumer_es["id"], "Consumer")

# The Spark job reads from Producer sink and writes to Consumer source
PRODUCER_READ_CONNECTION = producer_conns["destination"]
CONSUMER_WRITE_CONNECTION = consumer_conns["source"]

# These are for the browser (displayed for reference)
PRODUCER_WRITE_CONNECTION = producer_conns["source"]
CONSUMER_READ_CONNECTION = consumer_conns["destination"]

print("\n" + "=" * 60)
print("✅ Connection strings retrieved successfully!")
print("=" * 60)
print(f"\n📋 For the heartbeat website (https://heartbeatspark.z9.web.core.windows.net):")
print(f"   1. Producer Write Connection — paste into 'Producer Write Connection' box")
print(f"   2. Consumer Read Connection  — paste into 'Consumer Read Connection' box")
print(f"\nProducer Write:\n{PRODUCER_WRITE_CONNECTION}\n")
print(f"Consumer Read:\n{CONSUMER_READ_CONNECTION}\n")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

# ============================================================================
# Cell 2: Stateful Heartbeat Monitoring — Spark Structured Streaming
# ============================================================================

import json
import pandas as pd

from datetime import datetime
from typing import Iterator, Tuple
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.types import *
from pyspark.sql.streaming.state import GroupState, GroupStateTimeout

# Configure Spark for RocksDB state store
spark.conf.set("spark.sql.streaming.stateStore.providerClass", "org.apache.spark.sql.execution.streaming.state.RocksDBStateStoreProvider")
spark.conf.set("spark.sql.shuffle.partitions", "1")

# Extract Event Hub name from connection string
PRODUCER_EH_NAME = PRODUCER_READ_CONNECTION.split("EntityPath=")[1].split(";")[0]
HEARTBEAT_GRACE_PERIOD_MS = 5000
CHECKPOINT_LOCATION = "Files/checkpoints/heartbeat_state_stream"


class HeartbeatStatus:
    HEALTHY = "Healthy"
    INITIALIZING = "Initializing"
    UNHEALTHY = "Unhealthy"


# Schemas
heartbeat_input_schema = StructType([
    StructField("machine_name", StringType(), True),
    StructField("machine_time", StringType(), True),
])

state_schema = StructType([
    StructField("heartbeat_status", StringType(), True),
])

output_schema = StructType([
    StructField("machine_name", StringType(), True),
    StructField("last_status_change_time", TimestampType(), True),
    StructField("status", StringType(), True),
])


def create_starting_positions(eh_name, num_partitions=1):
    """Create starting position map for Event Hub consumer."""
    position_map = {}
    for partition_id in range(num_partitions):
        position_key = {"ehName": eh_name, "partitionId": partition_id}
        event_position = {"offset": "@latest", "seqNo": -1, "enqueuedTime": None, "isInclusive": True}
        position_map[json.dumps(position_key)] = event_position
    return json.dumps(position_map)


# Event Hub configurations
inputEhConf = {
    "eventhubs.connectionString": sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt(PRODUCER_READ_CONNECTION),
    "eventhubs.consumerGroup": "$Default",
    "eventhubs.startingPositions": create_starting_positions(PRODUCER_EH_NAME, num_partitions=1),
}

outputEhConf = {
    "eventhubs.connectionString": sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt(CONSUMER_WRITE_CONNECTION),
}


def heartbeat_state_transition(
    key: Tuple[str],
    pdf_iter: Iterator[pd.DataFrame],
    state: GroupState,
) -> Iterator[pd.DataFrame]:
    """
    State machine for tracking machine health based on heartbeats.
    
    Transitions: None → Initializing → Healthy ↔ Unhealthy (on timeout)
    Only emits output when state changes.
    """
    machine_name = key[0]

    if state.hasTimedOut:
        state.remove()
        yield pd.DataFrame({
            "machine_name": [machine_name],
            "last_status_change_time": [datetime.now()],
            "status": [HeartbeatStatus.UNHEALTHY],
        })
        return

    all_heartbeats = []
    for pdf in pdf_iter:
        if not pdf.empty:
            all_heartbeats.append(pdf)

    if not state.exists:
        state.setTimeoutTimestamp(state.getCurrentWatermarkMs() + HEARTBEAT_GRACE_PERIOD_MS)
        state.update((HeartbeatStatus.INITIALIZING,))
        yield pd.DataFrame({
            "machine_name": [machine_name],
            "last_status_change_time": [datetime.now()],
            "status": [HeartbeatStatus.INITIALIZING],
        })
        return

    if all_heartbeats:
        state.setTimeoutTimestamp(state.getCurrentWatermarkMs() + HEARTBEAT_GRACE_PERIOD_MS)
        previous_state = state.get
        previous_heartbeat_status = previous_state[0] if previous_state else HeartbeatStatus.UNHEALTHY
        current_heartbeat_status = HeartbeatStatus.HEALTHY
        state.update((current_heartbeat_status,))

        if previous_heartbeat_status != current_heartbeat_status:
            yield pd.DataFrame({
                "machine_name": [machine_name],
                "last_status_change_time": [datetime.now()],
                "status": [current_heartbeat_status],
            })
        else:
            yield pd.DataFrame(columns=["machine_name", "last_status_change_time", "status"])
    else:
        yield pd.DataFrame(columns=["machine_name", "last_status_change_time", "status"])


# Read from Producer EventStream
raw_stream = (
    spark.readStream
    .format("eventhubs")
    .options(**inputEhConf)
    .load()
)

# Parse heartbeat events
heartbeats = (
    raw_stream
    .select(
        col("enqueuedTime").alias("event_time"),
        from_json(col("body").cast("string"), heartbeat_input_schema).alias("data"),
    )
    .select("event_time", "data.*")
    .withWatermark("event_time", "30 seconds")
)

# Apply stateful processing
machine_status_stream = (
    heartbeats
    .groupBy("machine_name")
    .applyInPandasWithState(
        heartbeat_state_transition,
        outputStructType=output_schema,
        stateStructType=state_schema,
        outputMode="update",
        timeoutConf=GroupStateTimeout.EventTimeTimeout,
    )
)

# Clear previous checkpoints
if notebookutils.fs.exists(CHECKPOINT_LOCATION):
    notebookutils.fs.rm(CHECKPOINT_LOCATION, recurse=True)

# Write health state to Consumer EventStream
query = (
    machine_status_stream
    .filter(col("machine_name").isNotNull())
    .select(to_json(struct("*")).alias("body"))
    .writeStream
    .format("eventhubs")
    .options(**outputEhConf)
    .outputMode("update")
    .option("checkpointLocation", CHECKPOINT_LOCATION)
    .trigger(processingTime="0 seconds")
    .queryName("heartbeat_state_stream")
    .start()
)

print("🚀 Heartbeat state stream started!")
print("   Go to the heartbeat website and add producers to send heartbeats.")
print("   Pause producers to watch them go Unhealthy after 5s timeout.")
print("\n⏳ Waiting for termination (Ctrl+C or cancel cell to stop)...")

query.awaitTermination()

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
