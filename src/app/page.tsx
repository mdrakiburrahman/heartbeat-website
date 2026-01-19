'use client';

import { useState, useRef, useEffect } from 'react';
import { useEventHub } from '@/lib/useEventHub';
import { useEventHubProducer, HeartbeatMessage } from '@/lib/useEventHubProducer';
import { Highlight, themes } from 'prism-react-renderer';
import styles from './page.module.css';

interface Producer {
  id: number;
  name: string;
  isPaused: boolean;
  isExpanded: boolean;
  lastSentMessage: HeartbeatMessage | null;
  dots: { id: number; key: number }[];
}

export default function Home() {
  // Producer connection state (Read and Write)
  const [producerReadConnection, setProducerReadConnection] = useState('');
  const [producerReadStatus, setProducerReadStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [producerWriteConnection, setProducerWriteConnection] = useState('');
  const [producerWriteStatus, setProducerWriteStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  
  // Consumer connection state (Read and Write)
  const [consumerReadConnection, setConsumerReadConnection] = useState('');
  const [consumerReadStatus, setConsumerReadStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [consumerWriteConnection, setConsumerWriteConnection] = useState('');
  const [consumerWriteStatus, setConsumerWriteStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');

  // Producer list with extended state
  const [producers, setProducers] = useState<Producer[]>([]);
  const dotKeyRef = useRef(0);

  // Event Hub Producer hook
  const {
    status: producerHubStatus,
    connect: connectProducer,
    sendHeartbeat,
  } = useEventHubProducer();

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

  // Get Spark code with connection strings injected
  const getSparkCodeWithConnection = () => {
    if (!producerReadConnection || producerReadStatus !== 'connected' || 
        !consumerWriteConnection || consumerWriteStatus !== 'connected') {
      return sparkCode;
    }
    return sparkCode
      .replace('{PRODUCER_READ_CONNECTION}', producerReadConnection)
      .replace('{CONSUMER_WRITE_CONNECTION}', consumerWriteConnection);
  };

  const testConnection = async (value: string, isProducerWrite: boolean = false): Promise<'connected' | 'error' | 'disconnected'> => {
    if (value.includes('Endpoint=sb://') && value.includes('EntityPath=')) {
      // If this is the producer write connection, also connect the producer client
      if (isProducerWrite) {
        try {
          await connectProducer(value);
        } catch (err) {
          console.error('Failed to connect producer:', err);
        }
      }
      return 'connected';
    } else if (value.length > 0) {
      return 'error';
    }
    return 'disconnected';
  };

  const addProducer = () => {
    // Find the next available ID (lowest unused integer starting from 1)
    const usedIds = new Set(producers.map(p => p.id));
    let nextId = 1;
    while (usedIds.has(nextId)) {
      nextId++;
    }
    setProducers([...producers, { 
      id: nextId, 
      name: `Producer ${nextId}`,
      isPaused: false,
      isExpanded: false,
      lastSentMessage: null,
      dots: [],
    }]);
  };

  const toggleProducerPause = (id: number) => {
    setProducers(producers.map(p => 
      p.id === id ? { ...p, isPaused: !p.isPaused } : p
    ));
  };

  const toggleProducerExpand = (id: number) => {
    setProducers(producers.map(p => 
      p.id === id ? { ...p, isExpanded: !p.isExpanded } : p
    ));
  };

  // Send heartbeats every second for non-paused producers
  useEffect(() => {
    if (producerWriteStatus !== 'connected' || producerHubStatus !== 'connected') return;

    const interval = setInterval(async () => {
      for (const producer of producers) {
        if (!producer.isPaused) {
          const success = await sendHeartbeat(producer.name);
          if (success) {
            // Add a new dot and update lastSentMessage
            const newDotKey = ++dotKeyRef.current;
            setProducers(prev => prev.map(p => 
              p.id === producer.id 
                ? { 
                    ...p, 
                    dots: [...p.dots, { id: producer.id, key: newDotKey }],
                    lastSentMessage: {
                      ProducerName: producer.name,
                      Timestamp: new Date().toISOString(),
                      Healthy: true,
                    }
                  } 
                : p
            ));
          }
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [producers, producerWriteStatus, producerHubStatus, sendHeartbeat]);

  // Clean up dots after animation completes (12s animation)
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      setProducers(prev => prev.map(p => ({
        ...p,
        dots: p.dots.slice(-15) // Keep max 15 dots per producer (visible during 12s animation with 1s interval)
      })));
    }, 13000);

    return () => clearInterval(cleanupInterval);
  }, []);

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
    } else if (consumerReadConnection && consumerReadStatus === 'connected') {
      await connect(consumerReadConnection);
    }
  };

  const copyCode = async () => {
    const code = getSparkCodeWithConnection();
    await navigator.clipboard.writeText(code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // Spark code is enabled when Producer Read and Consumer Write are connected
  const isCodeEnabled = producerReadStatus === 'connected' && consumerWriteStatus === 'connected';

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
        <p className={styles.tagline}>Stateful Stream Processing demonstration with <span className={styles.fabricSparkGlow}>Fabric Spark</span>.</p>
        <span className={styles.badge}>Uses Fabric RTI EventStreams, Spark Structured Streaming with RocksDB</span>
      </header>

      <div className={styles.callout}>
        A guided tutorial for real-time, stateful health monitoring using Microsoft Fabric Spark Structured Streaming.
      </div>

      {/* Architecture Diagram */}
      <figure className={styles.architectureFigure}>
        <img src="/architecture.png" alt="Heartbeat architecture diagram" className={styles.architectureImage} />
      </figure>

      {/* Demo Workflow Section */}
      <section className={styles.workflow}>
        <h2>Demo</h2>

        {/* GIF 1 - Before Producer */}
        <figure className={styles.demoGif}>
          <img src="/producer-creation.gif" alt="Producer creation workflow demonstration" />
        </figure>

        <div className={styles.workflowArrow}>↓</div>

        {/* Connection Section */}
        <section className={styles.storySection}>
          {/* Producer Write Connection */}
          <article className={styles.connectionCard}>
            <div className={styles.connectionNumber}>1</div>
            <div className={styles.connectionSourceLabel}><span className={styles.browserLabel}>BROWSER</span></div>
            <h2>Producer Write Connection</h2>
            <p className={styles.connectionDesc}>Your browser's heartbeat producers being added below will send events here.</p>
            <textarea
              className={styles.connectionInput}
              placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
              value={producerWriteConnection}
              onChange={(e) => {
                setProducerWriteConnection(e.target.value);
                setProducerWriteStatus('disconnected');
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setProducerWriteStatus(await testConnection(producerWriteConnection, true))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[producerWriteStatus]}`} />
                <span className={styles.statusText}>
                  {producerWriteStatus === 'connected' ? 'Connected' : producerWriteStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
          </article>

          {/* Producer Read Connection */}
          <article className={styles.connectionCard}>
            <div className={styles.connectionNumber}>2</div>
            <div className={styles.connectionSourceLabel}><span className={styles.sparkLabel}>FABRIC SPARK</span></div>
            <h2>Producer Read Connection</h2>
            <p className={styles.connectionDesc}>Spark will read the heartbeats from the browser producers from here.</p>
            <textarea
              className={styles.connectionInput}
              placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
              value={producerReadConnection}
              onChange={(e) => {
                setProducerReadConnection(e.target.value);
                setProducerReadStatus('disconnected');
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setProducerReadStatus(await testConnection(producerReadConnection))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[producerReadStatus]}`} />
                <span className={styles.statusText}>
                  {producerReadStatus === 'connected' ? 'Connected' : producerReadStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
          </article>

          {/* Consumer Write Connection */}
          <article className={`${styles.connectionCard} ${styles.consumerCard}`}>
            <div className={styles.connectionNumber}>3</div>
            <div className={styles.connectionSourceLabel}><span className={styles.sparkLabel}>FABRIC SPARK</span></div>
            <h2>Consumer Write Connection</h2>
            <p className={styles.connectionDesc}>Spark writes the computed health state here.</p>
            <textarea
              className={styles.connectionInput}
              placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
              value={consumerWriteConnection}
              onChange={(e) => {
                setConsumerWriteConnection(e.target.value);
                setConsumerWriteStatus('disconnected');
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setConsumerWriteStatus(await testConnection(consumerWriteConnection))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[consumerWriteStatus]}`} />
                <span className={styles.statusText}>
                  {consumerWriteStatus === 'connected' ? 'Connected' : consumerWriteStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
          </article>

          {/* Consumer Read Connection */}
          <article className={`${styles.connectionCard} ${styles.consumerCard}`}>
            <div className={styles.connectionNumber}>4</div>
            <div className={styles.connectionSourceLabel}><span className={styles.browserLabel}>BROWSER</span></div>
            <h2>Consumer Read Connection</h2>
            <p className={styles.connectionDesc}>Your browser reads the processed health state from here.</p>
            <textarea
              className={styles.connectionInput}
              placeholder="Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
              value={consumerReadConnection}
              onChange={(e) => {
                setConsumerReadConnection(e.target.value);
                setConsumerReadStatus('disconnected');
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setConsumerReadStatus(await testConnection(consumerReadConnection))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[consumerReadStatus]}`} />
                <span className={styles.statusText}>
                  {consumerReadStatus === 'connected' ? 'Connected' : consumerReadStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
          </article>
        </section>

        <div className={styles.workflowArrow}>↓</div>

        {/* Step 1: Add Producer */}
        <div className={styles.workflowStep}>
          <div className={styles.stepNumber}>1</div>
          <div className={styles.stepContent}>
            <h3 className={styles.stepTitle}>Add a Heartbeat Producer</h3>
            <p className={styles.stepDesc}>
              This named heartbeat producer will send Events to EventStream.
            </p>
            <button 
              className={`${styles.addButton} ${producerWriteStatus !== 'connected' ? styles.disabled : ''}`}
              onClick={addProducer}
              disabled={producerWriteStatus !== 'connected'}
            >
              <span className={styles.plusIcon}>+</span> Add Producer
            </button>
            {producers.length > 0 && (
              <div className={styles.producerList}>
                {producers.map((p) => (
                  <div key={p.id} className={styles.producerRow}>
                    <div className={styles.producerItem}>
                      <span className={`${styles.statusDot} ${p.isPaused ? styles.paused : styles.connected}`} />
                      <span className={styles.producerName}>{p.name}</span>
                      <button 
                        className={`${styles.pausePlayBtn} ${p.isPaused ? styles.paused : ''}`}
                        onClick={() => toggleProducerPause(p.id)}
                        aria-label={p.isPaused ? `Resume ${p.name}` : `Pause ${p.name}`}
                        title={p.isPaused ? 'Resume' : 'Pause'}
                      >
                        {p.isPaused ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                          </svg>
                        )}
                      </button>
                      <button 
                        className={styles.expandBtn}
                        onClick={() => toggleProducerExpand(p.id)}
                        aria-label={p.isExpanded ? 'Collapse JSON' : 'Expand JSON'}
                        title={p.isExpanded ? 'Hide JSON' : 'Show JSON'}
                      >
                        <svg 
                          width="14" 
                          height="14" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2"
                          style={{ transform: p.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                        >
                          <path d="M6 9l6 6 6-6"/>
                        </svg>
                      </button>
                    </div>
                    <div className={styles.dotTrack}>
                      {p.dots.map((dot) => (
                        <span 
                          key={dot.key} 
                          className={styles.animatedDot}
                        />
                      ))}
                    </div>
                    {p.isExpanded && p.lastSentMessage && (
                      <div className={styles.jsonPreview}>
                        <Highlight
                          theme={themes.nightOwl}
                          code={JSON.stringify(p.lastSentMessage, null, 2)}
                          language="json"
                        >
                          {({ style, tokens, getLineProps, getTokenProps }) => (
                            <pre className={styles.jsonCode} style={{ ...style, background: 'transparent' }}>
                              {tokens.map((line, i) => (
                                <div key={i} {...getLineProps({ line })}>
                                  {line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })} />
                                  ))}
                                </div>
                              ))}
                            </pre>
                          )}
                        </Highlight>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.workflowArrow}>↓</div>

        {/* GIF 2 - Before Spark Code */}
        <figure className={styles.demoGif}>
          <img src="/processor-creation.gif" alt="Spark processor setup demonstration" />
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
              <Highlight
                theme={themes.nightOwl}
                code={getSparkCodeWithConnection()}
                language="python"
              >
                {({ className, style, tokens, getLineProps, getTokenProps }) => (
                  <pre className={styles.codeContent} style={{ ...style, background: 'transparent' }}>
                    {tokens.map((line, i) => (
                      <div key={i} {...getLineProps({ line })}>
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token })} />
                        ))}
                      </div>
                    ))}
                  </pre>
                )}
              </Highlight>
              {!isCodeEnabled && (
                <div className={styles.codeOverlay}>
                  <span>Configure Consumer Connection to enable</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.workflowArrow}>↓</div>

        {/* GIF 3 - After Spark Code */}
        <figure className={styles.demoGif}>
          <img src="/spark-streaming.gif" alt="Spark streaming demonstration" />
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
                  disabled={streamStatus === 'connecting' || consumerReadStatus !== 'connected'}
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
                        <Highlight
                          theme={themes.nightOwl}
                          code={typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body, null, 2)}
                          language="json"
                        >
                          {({ style, tokens, getLineProps, getTokenProps }) => (
                            <pre className={styles.messageBody} style={{ ...style, background: 'transparent' }}>
                              {tokens.map((line, i) => (
                                <div key={i} {...getLineProps({ line })}>
                                  {line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })} />
                                  ))}
                                </div>
                              ))}
                            </pre>
                          )}
                        </Highlight>
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
          <span className={styles.fancyText}>View more interactive demos at Fabric Jumpstart</span>
        </a>
      </section>
    </div>
  );
}
