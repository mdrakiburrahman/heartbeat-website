# Fabric notebook source

# MARKDOWN ********************

# # Fabric Stateful Streaming with RocksDB
# 
# In this notebook you will go hands-on with **Spark Structured Streaming** with Stateful operators. By the end you will have built a working **stateful streaming pipeline** using **RocksDB** as a state store and understand the primitives production streaming systems (such as Apache Flink) is built on.
# 
# **Refernences:**
# - [Documentation](https://jumpstart.fabric.microsoft.com/fabric_jumpstart/stateful-streaming-rocksdb/) — Full walkthrough and setup guide
# - [Companion Website](https://heartbeatspark.z9.web.core.windows.net/) — Live demo and additional resources
# 
# **What you'll learn in this Jumpstart:**
# - Connect to Azure EventHubs using Spark Structured Streaming
# - Implement stateful stream processing with `applyInPandasWithState`
# - Configure RocksDB as a persistent state store for fault tolerance
# - Build a real-time heartbeat monitoring system with health status transitions
# - Handle event-time watermarks and state timeouts
# 
# ---
# 
# <img src="https://heartbeatspark.z9.web.core.windows.net/architecture.png" width="800" style="display: block; margin: 20px auto;" />
# 
# ---

# METADATA ********************

# META {
# META   "language": "markdown",
# META   "language_group": "synapse_pyspark"
# META }

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

# CELL ********************

import json, requests
from pyspark.sql.types import StructType, StructField, StringType, TimestampType
from pyspark.sql.functions import col, from_json, to_json, struct
from pyspark.sql.streaming.state import GroupState, GroupStateTimeout
from typing import Tuple, Iterator
from datetime import datetime
import pandas as pd

workspace_id = notebookutils.runtime.context["currentWorkspaceId"]
fabric_token = notebookutils.credentials.getToken("https://api.fabric.microsoft.com")
headers = {"Authorization": f"Bearer {fabric_token}", "Content-Type": "application/json"}
base_url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"

items = requests.get(f"{base_url}/items", headers=headers).json()["value"]
producer_es = next((i for i in items if i["displayName"] == "heartbeat_producer" and i["type"] == "Eventstream"), None)
consumer_es = next((i for i in items if i["displayName"] == "heartbeat_consumer" and i["type"] == "Eventstream"), None)
if not producer_es or not consumer_es:
    raise ValueError("Could not find heartbeat_producer and/or heartbeat_consumer EventStreams.")

def get_connections(es_id):
    topology = requests.get(f"{base_url}/eventstreams/{es_id}/topology", headers=headers).json()
    conns = {}
    for src in topology.get("sources", []):
        if src["type"] == "CustomEndpoint":
            conns["source"] = requests.get(f"{base_url}/eventstreams/{es_id}/sources/{src['id']}/connection", headers=headers).json()["accessKeys"]["primaryConnectionString"]
    for dst in topology.get("destinations", []):
        if dst["type"] == "CustomEndpoint":
            conns["destination"] = requests.get(f"{base_url}/eventstreams/{es_id}/destinations/{dst['id']}/connection", headers=headers).json()["accessKeys"]["primaryConnectionString"]
    return conns

producer_conns = get_connections(producer_es["id"])
consumer_conns = get_connections(consumer_es["id"])

PRODUCER_READ_CONNECTION = producer_conns["destination"]
CONSUMER_WRITE_CONNECTION = consumer_conns["source"]
PRODUCER_WRITE_CONNECTION = producer_conns["source"]
CONSUMER_READ_CONNECTION = consumer_conns["destination"]

print("=" * 60)
print("CONNECTION STRINGS FOR HEARTBEAT WEBSITE")
print("=" * 60)
print(f"\n1) Producer Write Connection:\n{PRODUCER_WRITE_CONNECTION}\n")
print(f"2) Producer Read Connection:\n{PRODUCER_READ_CONNECTION}\n")
print(f"3) Consumer Write Connection:\n{CONSUMER_WRITE_CONNECTION}\n")
print(f"4) Consumer Read Connection:\n{CONSUMER_READ_CONNECTION}")
print("=" * 60)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

spark.conf.set("spark.sql.streaming.stateStore.providerClass", "org.apache.spark.sql.execution.streaming.state.RocksDBStateStoreProvider")
spark.conf.set("spark.sql.shuffle.partitions", "1")

PRODUCER_EH_NAME = PRODUCER_READ_CONNECTION.split("EntityPath=")[1].split(";")[0]
HEARTBEAT_GRACE_PERIOD_MS = 5000
CHECKPOINT_LOCATION = "Files/checkpoints/heartbeat_state_stream"

HEALTHY, INITIALIZING, UNHEALTHY = "Healthy", "Initializing", "Unhealthy"

heartbeat_input_schema = StructType([
    StructField("machine_name", StringType(), True),
    StructField("machine_time", StringType(), True),
])
state_schema = StructType([StructField("heartbeat_status", StringType(), True)])
output_schema = StructType([
    StructField("machine_name", StringType(), True),
    StructField("last_status_change_time", TimestampType(), True),
    StructField("status", StringType(), True),
])

def starting_positions(eh_name, n=1):
    return json.dumps({json.dumps({"ehName": eh_name, "partitionId": i}): {"offset": "@latest", "seqNo": -1, "enqueuedTime": None, "isInclusive": True} for i in range(n)})

inputEhConf = {
    "eventhubs.connectionString": sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt(PRODUCER_READ_CONNECTION),
    "eventhubs.consumerGroup": "$Default",
    "eventhubs.startingPositions": starting_positions(PRODUCER_EH_NAME),
}
outputEhConf = {
    "eventhubs.connectionString": sc._jvm.org.apache.spark.eventhubs.EventHubsUtils.encrypt(CONSUMER_WRITE_CONNECTION),
}

def heartbeat_state_transition(key: Tuple[str], pdf_iter: Iterator[pd.DataFrame], state: GroupState) -> Iterator[pd.DataFrame]:
    machine_name = key[0]
    empty = pd.DataFrame(columns=["machine_name", "last_status_change_time", "status"])
    def emit(status):
        return pd.DataFrame({"machine_name": [machine_name], "last_status_change_time": [datetime.now()], "status": [status]})

    if state.hasTimedOut:
        state.remove()
        yield emit(UNHEALTHY)
        return

    heartbeats = [pdf for pdf in pdf_iter if not pdf.empty]

    if not state.exists:
        state.setTimeoutTimestamp(state.getCurrentWatermarkMs() + HEARTBEAT_GRACE_PERIOD_MS)
        state.update((INITIALIZING,))
        yield emit(INITIALIZING)
        return

    if heartbeats:
        state.setTimeoutTimestamp(state.getCurrentWatermarkMs() + HEARTBEAT_GRACE_PERIOD_MS)
        prev = (state.get[0] if state.get else UNHEALTHY)
        state.update((HEALTHY,))
        yield emit(HEALTHY) if prev != HEALTHY else empty
    else:
        yield empty

heartbeats = (
    spark.readStream.format("eventhubs").options(**inputEhConf).load()
    .select(col("enqueuedTime").alias("event_time"), from_json(col("body").cast("string"), heartbeat_input_schema).alias("data"))
    .select("event_time", "data.*")
    .withWatermark("event_time", "30 seconds")
)

machine_status_stream = heartbeats.groupBy("machine_name").applyInPandasWithState(
    heartbeat_state_transition, outputStructType=output_schema, stateStructType=state_schema,
    outputMode="update", timeoutConf=GroupStateTimeout.EventTimeTimeout,
)

if notebookutils.fs.exists(CHECKPOINT_LOCATION):
    notebookutils.fs.rm(CHECKPOINT_LOCATION, recurse=True)

query = (
    machine_status_stream.filter(col("machine_name").isNotNull())
    .select(to_json(struct("*")).alias("body"))
    .writeStream.format("eventhubs").options(**outputEhConf)
    .outputMode("update").option("checkpointLocation", CHECKPOINT_LOCATION)
    .trigger(processingTime="0 seconds").queryName("heartbeat_state_stream").start()
)

query.awaitTermination()

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }
