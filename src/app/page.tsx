'use client';

import { useState, useRef, useEffect } from 'react';
import { useEventHub } from '@/lib/useEventHub';
import styles from './page.module.css';

export default function Home() {
  // Producer connection state
  const [producerConnectionString, setProducerConnectionString] = useState('');
  const [producerStatus, setProducerStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  
  // Consumer connection state
  const [consumerConnectionString, setConsumerConnectionString] = useState('');
  const [consumerStatus, setConsumerStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');

  // Producer list
  const [producers, setProducers] = useState<{ id: number; name: string }[]>([]);

  // Spark code from file
  const [sparkCode, setSparkCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);

  // Live stream from actual Event Hub connection
  const {
    status: streamStatus,
    messages,
    error,
    connect,
    disconnect,
    clearMessages,
  } = useEventHub(200);

  const streamEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Load Spark code from file
  useEffect(() => {
    fetch('/spark-streaming-code.py')
      .then(res => res.text())
      .then(code => setSparkCode(code))
      .catch(() => setSparkCode('# Failed to load Spark code'));
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    if (autoScroll && streamEndRef.current) {
      streamEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  // Get Spark code with consumer connection string injected
  const getSparkCodeWithConnection = () => {
    if (!consumerConnectionString || consumerStatus !== 'connected') {
      return sparkCode;
    }
    return sparkCode.replace('{CONSUMER_CONNECTION_STRING}', consumerConnectionString);
  };

  const testProducerConnection = () => {
    if (producerConnectionString.includes('Endpoint=sb://') && producerConnectionString.includes('EntityPath=')) {
      setProducerStatus('connected');
    } else if (producerConnectionString.length > 0) {
      setProducerStatus('error');
    } else {
      setProducerStatus('disconnected');
    }
  };

  const testConsumerConnection = () => {
    if (consumerConnectionString.includes('Endpoint=sb://') && consumerConnectionString.includes('EntityPath=')) {
      setConsumerStatus('connected');
    } else if (consumerConnectionString.length > 0) {
      setConsumerStatus('error');
    } else {
      setConsumerStatus('disconnected');
    }
  };

  const addProducer = () => {
    // Find the next available ID (lowest unused integer starting from 1)
    const usedIds = new Set(producers.map(p => p.id));
    let nextId = 1;
    while (usedIds.has(nextId)) {
      nextId++;
    }
    setProducers([...producers, { id: nextId, name: `Producer ${nextId}` }]);
  };

  const removeProducer = (id: number) => {
    setProducers(producers.filter(p => p.id !== id));
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const handleConnectStream = async () => {
    if (streamStatus === 'connected' || streamStatus === 'connecting') {
      disconnect();
    } else if (consumerConnectionString) {
      await connect(consumerConnectionString);
    }
  };

  const copyCode = async () => {
    const code = getSparkCodeWithConnection();
    await navigator.clipboard.writeText(code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const isCodeEnabled = consumerStatus === 'connected';

  return (
    <div className={styles.container}>
      {/* Hero Section */}
      <header className={styles.hero}>
        <h1 className={styles.logo}>
          <svg className={styles.logoIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              fill="url(#heartGradient)"
            />
            <defs>
              <linearGradient id="heartGradient" x1="2" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
                <stop stopColor="#89e8ad" />
                <stop offset="0.5" stopColor="#4ade80" />
                <stop offset="1" stopColor="#22c55e" />
              </linearGradient>
            </defs>
          </svg>
          heartbeat
        </h1>
        <p className={styles.tagline}>Stateful Stream Processing Demonstration with <span className={styles.fabricSparkGlow}>Fabric Spark</span>.</p>
        <span className={styles.badge}>Uses Fabric RTI EventStreams, Spark Structured Streaming with RocksDB</span>
      </header>

      <div className={styles.callout}>
        A guided tutorial for real-time health monitoring using Microsoft Fabric and Spark Structured Streaming.
      </div>

      {/* Connection Section */}
      <section className={styles.storySection}>
        {/* Producer Connection */}
        <article className={styles.connectionCard}>
          <h2>Producer Connection</h2>
          <textarea
            className={styles.connectionInput}
            placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
            value={producerConnectionString}
            onChange={(e) => {
              setProducerConnectionString(e.target.value);
              setProducerStatus('disconnected');
            }}
            onFocus={(e) => e.target.placeholder = ''}
            onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
          />
          <div className={styles.connectionActions}>
            <button className={styles.testButton} onClick={testProducerConnection}>
              Test Connection
            </button>
            <div className={styles.statusIndicator}>
              <span className={`${styles.statusDot} ${styles[producerStatus]}`} />
              <span className={styles.statusText}>
                {producerStatus === 'connected' ? 'Connected' : producerStatus === 'error' ? 'Error' : 'Not Connected'}
              </span>
            </div>
          </div>
        </article>

        {/* Consumer Connection */}
        <article className={`${styles.connectionCard} ${styles.consumerCard}`}>
          <h2>Consumer Connection</h2>
          <textarea
            className={styles.connectionInput}
            placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
            value={consumerConnectionString}
            onChange={(e) => {
              setConsumerConnectionString(e.target.value);
              setConsumerStatus('disconnected');
            }}
            onFocus={(e) => e.target.placeholder = ''}
            onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
          />
          <div className={styles.connectionActions}>
            <button className={styles.testButton} onClick={testConsumerConnection}>
              Test Connection
            </button>
            <div className={styles.statusIndicator}>
              <span className={`${styles.statusDot} ${styles[consumerStatus]}`} />
              <span className={styles.statusText}>
                {consumerStatus === 'connected' ? 'Connected' : consumerStatus === 'error' ? 'Error' : 'Not Connected'}
              </span>
            </div>
          </div>
        </article>
      </section>

      {/* Demo Workflow Section */}
      <section className={styles.workflow}>
        <h2>Demo</h2>

        {/* Step 1: Add Producer */}
        <div className={styles.workflowStep}>
          <div className={styles.stepNumber}>1</div>
          <div className={styles.stepContent}>
            <h3 className={styles.stepTitle}>Add a Heartbeat Producer</h3>
            <p className={styles.stepDesc}>
              This named heartbeat producer will send Events to EventStream.
            </p>
            <button 
              className={`${styles.addButton} ${producerStatus !== 'connected' ? styles.disabled : ''}`}
              onClick={addProducer}
              disabled={producerStatus !== 'connected'}
            >
              <span className={styles.plusIcon}>+</span> Add Producer
            </button>
            {producers.length > 0 && (
              <div className={styles.producerList}>
                {producers.map((p) => (
                  <div key={p.id} className={styles.producerItem}>
                    <span className={`${styles.statusDot} ${styles.connected}`} />
                    {p.name}
                    <button 
                      className={styles.removeProducerBtn}
                      onClick={() => removeProducer(p.id)}
                      aria-label={`Remove ${p.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* GIF Placeholder 1 */}
        <figure className={styles.demoGif}>
          <img src="/producer-creation.gif" alt="Producer creation workflow demonstration" />
        </figure>

        <div className={styles.workflowArrow}>↓</div>

        {/* Step 2: Spark Stream */}
        <div className={`${styles.workflowStep} ${styles.aiStep}`}>
          <div className={styles.stepNumber}>2</div>
          <div className={styles.stepContent}>
            <h3 className={styles.stepTitle}>Start Spark Stream in Fabric Notebook</h3>
            <p className={styles.stepDesc}>
              Spark will read the Event Stream and mark the device as healthy. If the device disconnects for 5 seconds, 
              Spark immediately marks it as unhealthy.
            </p>
            
            {/* Python Code Block */}
            <div className={`${styles.codeBlock} ${!isCodeEnabled ? styles.dimmed : ''}`}>
              <div className={styles.codeHeader}>
                <div className={styles.codeDots}>
                  <span></span><span></span><span></span>
                </div>
                <span className={styles.codeLabel}>Python</span>
                <button 
                  className={`${styles.copyButton} ${codeCopied ? styles.copied : ''}`}
                  onClick={copyCode}
                  disabled={!isCodeEnabled}
                >
                  {codeCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className={styles.codeContent}>
                <code>{getSparkCodeWithConnection()}</code>
              </pre>
              {!isCodeEnabled && (
                <div className={styles.codeOverlay}>
                  <span>Configure Consumer Connection to enable</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* GIF Placeholder 2 */}
        <figure className={styles.demoGif}>
          <img src="/processor-creation.gif" alt="Spark processor setup demonstration" />
        </figure>

        <div className={styles.workflowArrow}>↓</div>

        {/* Step 3: Add Consumer / Live Stream */}
        <div className={styles.workflowStep}>
          <div className={styles.stepNumber}>3</div>
          <div className={styles.stepContent}>
            <h3 className={styles.stepTitle}>Add Consumer</h3>
            <p className={styles.stepDesc}>
              Consumer reads from the Spark generated Health State.
            </p>
            
            {/* Live Stream Panel */}
            <div className={styles.streamPanel}>
              <div className={styles.streamHeader}>
                <h4 className={styles.streamTitle}>
                  <svg className={styles.streamIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.5 4.5a2.5 2.5 0 0 0-5 0v15a2.5 2.5 0 0 0 5 0v-15Z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M20.5 4.5a2.5 2.5 0 0 0-5 0v15a2.5 2.5 0 0 0 5 0v-15Z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M3 12h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Live Stream
                </h4>
                <div className={styles.streamControls}>
                  <label className={styles.autoScrollLabel}>
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    Auto-scroll
                  </label>
                  <span className={styles.messageCount}>{messages.length} messages</span>
                </div>
              </div>

              <div className={styles.streamActions}>
                <button
                  className={`${styles.streamButton} ${streamStatus === 'connected' ? styles.streamConnected : ''}`}
                  onClick={handleConnectStream}
                  disabled={streamStatus === 'connecting' || !consumerConnectionString}
                >
                  {streamStatus === 'connecting' ? 'Connecting...' : streamStatus === 'connected' ? 'Disconnect' : 'Connect'}
                </button>
                <button
                  className={`${styles.streamButton} ${styles.clearButton}`}
                  onClick={clearMessages}
                  disabled={messages.length === 0}
                >
                  Clear
                </button>
              </div>

              {error && <div className={styles.streamError}>Error: {error}</div>}

              <div className={styles.streamContent}>
                {messages.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <p>No messages yet</p>
                    <p className={styles.emptyHint}>Connect to the Event Hub to start streaming health state data</p>
                  </div>
                ) : (
                  <>
                    {[...messages].reverse().map((msg) => (
                      <div key={msg.id} className={styles.messageItem}>
                        <div className={styles.messageMeta}>
                          <span className={styles.messageTimestamp}>{formatTimestamp(msg.timestamp)}</span>
                          <span className={styles.messagePartition}>Partition: {msg.partitionId}</span>
                          <span className={styles.messageSequence}>Seq: {msg.sequenceNumber}</span>
                        </div>
                        <pre className={styles.messageBody}>{msg.body}</pre>
                      </div>
                    ))}
                    <div ref={streamEndRef} />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* Open Source Badge */}
      <section className={styles.openSource}>
        <a 
          href="https://jumpstart.fabric.microsoft.com" 
          className={styles.fancyTextContainer}
          target="_blank" 
          rel="noopener noreferrer"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            e.currentTarget.style.setProperty('--mouse-x', `${x}px`);
            e.currentTarget.style.setProperty('--mouse-y', `${y}px`);
          }}
        >
          <span className={styles.fancyText}>View more RTI demos at Fabric Jumpstart</span>
        </a>
      </section>
    </div>
  );
}
