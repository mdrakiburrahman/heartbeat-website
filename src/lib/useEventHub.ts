'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { AzureSASCredential } from '@azure/core-auth';
import {
  EventHubConsumerClient,
  latestEventPosition,
  ReceivedEventData,
  PartitionContext,
  Subscription,
} from '@azure/event-hubs';
import {
  StreamMessage,
  parseConnectionString,
  validateConnectionString,
  Authorization,
  stringifyEventBody,
} from './eventHubUtils';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseEventHubReturn {
  status: ConnectionStatus;
  messages: StreamMessage[];
  error: string | null;
  messageCount: number;
  connect: (connectionString: string, consumerGroup?: string) => Promise<void>;
  disconnect: () => void;
  clearMessages: () => void;
}

const MAX_MESSAGES = 500;
const SAS_TOKEN_TTL_SECONDS = 3600; // 1 hour
const MAX_BATCH_SIZE = 100;
const MAX_WAIT_TIME_SECONDS = 5;

export function useEventHub(maxMessages: number = MAX_MESSAGES): UseEventHubReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0);

  const consumerClientRef = useRef<EventHubConsumerClient | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);
  const isConnectingRef = useRef(false);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setMessageCount(0);
  }, []);

  const disconnect = useCallback(async () => {
    console.log('[EventHub] Disconnecting...');
    
    try {
      // Close subscription first
      if (subscriptionRef.current) {
        await subscriptionRef.current.close();
        subscriptionRef.current = null;
      }

      // Then close client
      if (consumerClientRef.current) {
        await consumerClientRef.current.close();
        consumerClientRef.current = null;
      }
    } catch (err) {
      console.error('[EventHub] Error during disconnect:', err);
    }

    setStatus('disconnected');
    setError(null);
    isConnectingRef.current = false;
  }, []);

  const connect = useCallback(
    async (connectionString: string, consumerGroup: string = '$Default') => {
      // Prevent multiple simultaneous connection attempts
      if (isConnectingRef.current) {
        console.log('[EventHub] Connection already in progress, ignoring...');
        return;
      }

      // Validate connection string
      const validation = validateConnectionString(connectionString);
      if (!validation.valid) {
        setError(validation.error || 'Invalid connection string');
        setStatus('error');
        return;
      }

      const info = parseConnectionString(connectionString);
      if (!info) {
        setError('Failed to parse connection string');
        setStatus('error');
        return;
      }

      // Disconnect any existing connection
      await disconnect();

      isConnectingRef.current = true;
      setStatus('connecting');
      setError(null);

      try {
        console.log('[EventHub] Connecting to:', info.fullyQualifiedNamespace);
        console.log('[EventHub] Event Hub:', info.entityPath);
        console.log('[EventHub] Consumer Group:', consumerGroup);

        // Generate SAS token using the same method as Azure Portal
        const namespaceEndpoint = `https://${info.fullyQualifiedNamespace}`;
        const sasToken = await Authorization.createRuntimeSASToken(
          namespaceEndpoint,
          info.sharedAccessKeyName,
          info.sharedAccessKey,
          SAS_TOKEN_TTL_SECONDS
        );

        console.log('[EventHub] SAS Token generated successfully');

        // Create credential from SAS token
        const credential = new AzureSASCredential(sasToken);

        // Create the consumer client (same pattern as Azure Portal)
        const client = new EventHubConsumerClient(
          consumerGroup,
          info.fullyQualifiedNamespace,
          info.entityPath,
          credential,
          {
            identifier: `HeartbeatViewer-${Date.now()}`,
          }
        );

        consumerClientRef.current = client;

        // Process events callback
        const processEvents = async (events: ReceivedEventData[], context: PartitionContext) => {
          if (events.length === 0) {
            return;
          }

          console.log(`[EventHub] Received ${events.length} events from partition ${context.partitionId}`);

          const incomingMessages: StreamMessage[] = events.map((event) => ({
            id: `${context.partitionId}-${event.sequenceNumber}-${Date.now()}`,
            timestamp: event.enqueuedTimeUtc,
            partitionId: context.partitionId,
            offset: String(event.offset),
            sequenceNumber: event.sequenceNumber,
            body: stringifyEventBody(event.body),
            contentType: event.contentType,
            messageId: event.messageId as string | number | undefined,
            correlationId: event.correlationId ? String(event.correlationId) : undefined,
            properties: event.properties as Record<string, unknown> | undefined,
          }));

          setMessages((prev) => {
            const newMessages = [...incomingMessages, ...prev];
            return newMessages.slice(0, maxMessages);
          });

          setMessageCount((prev) => prev + events.length);
        };

        // Process error callback
        const processError = async (err: Error, context: PartitionContext) => {
          console.error(`[EventHub] Error on partition ${context.partitionId}:`, err);
          console.error('[EventHub] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
          const errorMsg = err.message || err.name || String(err);
          setError(`Partition ${context.partitionId}: ${errorMsg}`);
          // Don't set status to error - keep trying to receive
        };

        // Subscribe to all partitions starting from latest position
        const subscription = client.subscribe(
          {
            processEvents,
            processError,
          },
          {
            startPosition: latestEventPosition,
            maxBatchSize: MAX_BATCH_SIZE,
            maxWaitTimeInSeconds: MAX_WAIT_TIME_SECONDS,
          }
        );

        subscriptionRef.current = subscription;
        setStatus('connected');
        console.log('[EventHub] Successfully subscribed to events');

      } catch (err) {
        console.error('[EventHub] Connection error:', err);
        console.error('[EventHub] Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2));
        let errorMessage = 'Failed to connect to Event Hub';
        if (err instanceof Error) {
          errorMessage = err.message || err.name || String(err);
          if ('code' in err) {
            errorMessage += ` (Code: ${(err as Error & { code: string }).code})`;
          }
        }
        setError(errorMessage);
        setStatus('error');
        
        // Clean up on error
        if (consumerClientRef.current) {
          try {
            await consumerClientRef.current.close();
          } catch {
            // Ignore cleanup errors
          }
          consumerClientRef.current = null;
        }
      } finally {
        isConnectingRef.current = false;
      }
    },
    [disconnect, maxMessages]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    messages,
    error,
    messageCount,
    connect,
    disconnect,
    clearMessages,
  };
}
