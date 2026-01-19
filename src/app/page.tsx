'use client';

import { useState, useRef, useEffect } from 'react';
import { useEventHub } from '@/lib/useEventHub';
import { useEventHubProducer, HeartbeatMessage } from '@/lib/useEventHubProducer';
import { Highlight, themes } from 'prism-react-renderer';
import styles from './page.module.css';

type HealthStatus = 'Unknown' | 'Initializing' | 'Healthy' | 'Unhealthy';

interface ProducerHealth {
  status: HealthStatus;
  lastStatusChangeTime: string | null;
  isExpanded: boolean;
}

interface Producer {
  id: number;
  name: string;
  isPaused: boolean;
  isExpanded: boolean;
  lastSentMessage: HeartbeatMessage | null;
  dots: { id: number; key: number }[];
  health: ProducerHealth;
}

interface ParsedConnectionDetails {
  namespace: string;
  topic: string;
  keyName: string;
  key: string;
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

  // Parsed connection details
  const [producerWriteDetails, setProducerWriteDetails] = useState<ParsedConnectionDetails | null>(null);
  const [producerReadDetails, setProducerReadDetails] = useState<ParsedConnectionDetails | null>(null);
  const [consumerWriteDetails, setConsumerWriteDetails] = useState<ParsedConnectionDetails | null>(null);
  const [consumerReadDetails, setConsumerReadDetails] = useState<ParsedConnectionDetails | null>(null);

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
  const [streamPanelExpanded, setStreamPanelExpanded] = useState(false);

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

  // Parse incoming messages to update producer health states
  useEffect(() => {
    if (messages.length === 0) return;
    
    // Get the latest message
    const latestMessage = messages[0];
    try {
      const body = typeof latestMessage.body === 'string' 
        ? JSON.parse(latestMessage.body) 
        : latestMessage.body;
      
      if (body && body.machine_name && body.status) {
        const machineName = body.machine_name as string;
        const status = body.status as HealthStatus;
        const lastStatusChangeTime = body.last_status_change_time as string || null;
        
        setProducers(prev => prev.map(p => 
          p.name === machineName 
            ? { 
                ...p, 
                health: {
                  ...p.health,
                  status,
                  lastStatusChangeTime,
                }
              } 
            : p
        ));
      }
    } catch {
      // Ignore parse errors
    }
  }, [messages]);

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

  const parseConnectionString = (connectionString: string): ParsedConnectionDetails | null => {
    try {
      // Extract namespace from Endpoint
      const endpointMatch = connectionString.match(/Endpoint=sb:\/\/([^.]+)\.servicebus\.windows\.net/);
      const namespace = endpointMatch ? endpointMatch[1] : '';

      // Extract EntityPath (topic)
      const entityPathMatch = connectionString.match(/EntityPath=([^;]+)/);
      const topic = entityPathMatch ? entityPathMatch[1] : '';

      // Extract SharedAccessKeyName
      const keyNameMatch = connectionString.match(/SharedAccessKeyName=([^;]+)/);
      const keyName = keyNameMatch ? keyNameMatch[1] : '';

      // Extract SharedAccessKey
      const keyMatch = connectionString.match(/SharedAccessKey=([^;]+)/);
      const key = keyMatch ? keyMatch[1] : '';

      if (namespace && topic && keyName && key) {
        return { namespace, topic, keyName, key };
      }
      return null;
    } catch {
      return null;
    }
  };

  const testConnection = async (
    value: string, 
    setDetails: (details: ParsedConnectionDetails | null) => void,
    isProducerWrite: boolean = false
  ): Promise<'connected' | 'error' | 'disconnected'> => {
    if (value.includes('Endpoint=sb://') && value.includes('EntityPath=')) {
      const parsed = parseConnectionString(value);
      setDetails(parsed);
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
      setDetails(null);
      return 'error';
    }
    setDetails(null);
    return 'disconnected';
  };

  const MAX_PRODUCERS = 5;

  const addProducer = async () => {
    if (producers.length >= MAX_PRODUCERS) return;
    // Find the next available ID (lowest unused integer starting from 1)
    const usedIds = new Set(producers.map(p => p.id));
    let nextId = 1;
    while (usedIds.has(nextId)) {
      nextId++;
    }
    
    const isFirstProducer = producers.length === 0;
    
    setProducers([...producers, { 
      id: nextId, 
      name: `Producer ${nextId}`,
      isPaused: false,
      isExpanded: false,
      lastSentMessage: null,
      dots: [],
      health: {
        status: 'Unknown',
        lastStatusChangeTime: null,
        isExpanded: false,
      },
    }]);
    
    // Auto-connect consumer when first producer is added
    if (isFirstProducer && consumerReadConnection && consumerReadStatus === 'connected' && streamStatus !== 'connected' && streamStatus !== 'connecting') {
      await connect(consumerReadConnection);
    }
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

  const toggleHealthExpand = (id: number) => {
    setProducers(producers.map(p => 
      p.id === id ? { ...p, health: { ...p.health, isExpanded: !p.health.isExpanded } } : p
    ));
  };

  const getHealthColorClass = (status: HealthStatus) => {
    switch (status) {
      case 'Healthy': return styles.healthGreen;
      case 'Unhealthy': return styles.healthRed;
      case 'Initializing': return styles.healthBlue;
      default: return styles.healthGrey;
    }
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
                      machine_name: producer.name,
                      machine_time: new Date().toISOString(),
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

      {/* YouTube Video */}
      <section className={styles.workflow}>
        <div className={styles.videoContainer}>
          <iframe
            width="560"
            height="315"
            src="https://www.youtube.com/embed/qz3d00dfWvQ?si=kjd-ENzVy3qXk79g"
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </section>

      <div className={styles.callout}>
        A guided tutorial for real-time, stateful health monitoring using Microsoft Fabric Spark Structured Streaming.
      </div>

      {/* Architecture Diagram */}
      <section className={styles.workflow}>
        <h2>Architecture</h2>
        <figure className={styles.architectureFigure}>
          <img src="/architecture.png" alt="Heartbeat architecture diagram" className={styles.architectureImage} />
        </figure>
      </section>

      {/* Demo Workflow Section */}
      <section className={styles.workflow}>
        <h2>Demo</h2>
        <p className={styles.demoIntro}>
          Create 2 Fabric Event Streams called <strong>Producer</strong> and <strong>Consumer</strong>. Add a &quot;Custom endpoint&quot; Source and Sink, and grab the Event Hub Connection Strings.
        </p>

        {/* GIF 1 - Before Producer */}
        <figure className={styles.demoGif}>
          <img src="/producer-creation.gif" alt="Producer creation workflow demonstration" />
        </figure>

        <div className={styles.workflowArrow}>↓</div>

        {/* Connection Section */}
        <section className={styles.storySection}>
          <p className={styles.connectionIntro}>
            Enter your EventStream Event Hub Connection-string below. This is a static website with no backend server, all connections will be established without leaving your browser.
          </p>
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
                setProducerWriteDetails(null);
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setProducerWriteStatus(await testConnection(producerWriteConnection, setProducerWriteDetails, true))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[producerWriteStatus]}`} />
                <span className={styles.statusText}>
                  {producerWriteStatus === 'connected' ? 'Connected' : producerWriteStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
            {producerWriteDetails && (
              <div className={styles.connectionDetails}>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Namespace</span><span className={styles.detailValue}>{producerWriteDetails.namespace}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Topic</span><span className={styles.detailValue}>{producerWriteDetails.topic}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key Name</span><span className={styles.detailValue}>{producerWriteDetails.keyName}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key</span><span className={styles.detailValue}>{producerWriteDetails.key}</span></div>
              </div>
            )}
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
                setProducerReadDetails(null);
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setProducerReadStatus(await testConnection(producerReadConnection, setProducerReadDetails))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[producerReadStatus]}`} />
                <span className={styles.statusText}>
                  {producerReadStatus === 'connected' ? 'Connected' : producerReadStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
            {producerReadDetails && (
              <div className={styles.connectionDetails}>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Namespace</span><span className={styles.detailValue}>{producerReadDetails.namespace}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Topic</span><span className={styles.detailValue}>{producerReadDetails.topic}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key Name</span><span className={styles.detailValue}>{producerReadDetails.keyName}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key</span><span className={styles.detailValue}>{producerReadDetails.key}</span></div>
              </div>
            )}
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
                setConsumerWriteDetails(null);
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setConsumerWriteStatus(await testConnection(consumerWriteConnection, setConsumerWriteDetails))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[consumerWriteStatus]}`} />
                <span className={styles.statusText}>
                  {consumerWriteStatus === 'connected' ? 'Connected' : consumerWriteStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
            {consumerWriteDetails && (
              <div className={styles.connectionDetails}>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Namespace</span><span className={styles.detailValue}>{consumerWriteDetails.namespace}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Topic</span><span className={styles.detailValue}>{consumerWriteDetails.topic}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key Name</span><span className={styles.detailValue}>{consumerWriteDetails.keyName}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key</span><span className={styles.detailValue}>{consumerWriteDetails.key}</span></div>
              </div>
            )}
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
                setConsumerReadDetails(null);
              }}
              onFocus={(e) => e.target.placeholder = ''}
              onBlur={(e) => e.target.placeholder = 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'}
            />
            <div className={styles.connectionActions}>
              <button className={styles.testButton} onClick={async () => setConsumerReadStatus(await testConnection(consumerReadConnection, setConsumerReadDetails))}>
                Test Connection
              </button>
              <div className={styles.statusIndicator}>
                <span className={`${styles.statusDot} ${styles[consumerReadStatus]}`} />
                <span className={styles.statusText}>
                  {consumerReadStatus === 'connected' ? 'Connected' : consumerReadStatus === 'error' ? 'Error' : 'Not Connected'}
                </span>
              </div>
            </div>
            {consumerReadDetails && (
              <div className={styles.connectionDetails}>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Namespace</span><span className={styles.detailValue}>{consumerReadDetails.namespace}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Topic</span><span className={styles.detailValue}>{consumerReadDetails.topic}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key Name</span><span className={styles.detailValue}>{consumerReadDetails.keyName}</span></div>
                <div className={styles.detailRow}><span className={styles.detailLabel}>Key</span><span className={styles.detailValue}>{consumerReadDetails.key}</span></div>
              </div>
            )}
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
              className={`${styles.addButton} ${(producerWriteStatus !== 'connected' || producers.length >= MAX_PRODUCERS) ? styles.disabled : ''}`}
              onClick={addProducer}
              disabled={producerWriteStatus !== 'connected' || producers.length >= MAX_PRODUCERS}
            >
              <span className={styles.plusIcon}>+</span> Add Producer
            </button>
            {producers.length >= MAX_PRODUCERS && (
              <p className={styles.producerCapMessage}>Producers are capped at 5 to preserve browser responsiveness</p>
            )}
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

        {/* Step 3: Health Report */}
        <div className={styles.workflowStep}>
          <div className={styles.stepNumber}>3</div>
          <div className={styles.stepContent}>
            <h3 className={styles.stepTitle}>Health Report</h3>
            <p className={styles.stepDesc}>
              Real-time health monitoring powered by Spark. Events only appear when state changes.
            </p>
            
            {/* Producer Health Status Display */}
            {producers.length > 0 && (
              <div className={styles.healthStatusPanel}>
                <div className={styles.healthStatusHeader}>
                  <h4 className={styles.healthStatusTitle}>Producer Health Status</h4>
                  <span className={`${styles.connectionStatus} ${streamStatus === 'connected' ? styles.connected : ''}`}>
                    <span className={styles.connectionDot}></span>
                    {streamStatus === 'connecting' ? 'CONNECTING...' : streamStatus === 'connected' ? 'CONNECTED' : 'DISCONNECTED'}
                  </span>
                </div>
                <div className={styles.healthStatusGrid}>
                  {producers.map((p) => (
                    <div key={p.id} className={styles.healthStatusCard}>
                      <div className={styles.healthStatusRow}>
                        <span className={`${styles.healthBadge} ${getHealthColorClass(p.health.status)}`}>
                          <span className={styles.healthDot}></span>
                          <span className={styles.healthText}>{p.health.status.toUpperCase()}</span>
                        </span>
                        <span className={styles.healthProducerName}>{p.name}</span>
                        <button 
                          className={styles.healthExpandBtn}
                          onClick={() => toggleHealthExpand(p.id)}
                          aria-label={p.health.isExpanded ? 'Collapse details' : 'Expand details'}
                          title={p.health.isExpanded ? 'Hide details' : 'Show details'}
                        >
                          <svg 
                            width="14" 
                            height="14" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2"
                            style={{ transform: p.health.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                          >
                            <path d="M6 9l6 6 6-6"/>
                          </svg>
                        </button>
                      </div>
                      {p.health.isExpanded && p.health.lastStatusChangeTime && (
                        <div className={styles.healthDetails}>
                          <span className={styles.healthTimestamp}>
                            Last change: {new Date(p.health.lastStatusChangeTime).toLocaleTimeString()}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Live Stream Panel */}
            <div className={styles.streamPanel}>
              <div className={styles.streamHeader} onClick={() => setStreamPanelExpanded(!streamPanelExpanded)} style={{ cursor: 'pointer' }}>
                <h4 className={styles.streamTitle}>
                  <svg className={styles.streamIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.5 4.5a2.5 2.5 0 0 0-5 0v15a2.5 2.5 0 0 0 5 0v-15Z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M20.5 4.5a2.5 2.5 0 0 0-5 0v15a2.5 2.5 0 0 0 5 0v-15Z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M3 12h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  State Change Events
                </h4>
                <div className={styles.streamControls}>
                  <span className={styles.messageCount}>{messages.length} events</span>
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                    style={{ transform: streamPanelExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                  >
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </div>

              {error && <div className={styles.streamError}>Error: {error}</div>}

              {streamPanelExpanded && (
                <div className={styles.streamContent}>
                {messages.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <p>No messages yet</p>
                    <p className={styles.emptyHint}>Click Connect to start streaming health state data from Spark</p>
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
              )}
            </div>
          </div>
        </div>

        <div className={styles.workflowArrow}>↓</div>

        {/* Step 4: Play around */}
        <div className={styles.workflowStep}>
          <div className={styles.stepNumber}>4</div>
          <div className={styles.stepContent}>
            <h3 className={styles.stepTitle}>Play around!</h3>
            <p className={styles.stepDesc}>
              Scroll up to pause producers to watch them go unhealthy when heartbeat times out in RocksDB after 5 seconds. Restart to watch them initialize and go to healthy.
            </p>
            <p className={styles.stepNote}>
              <em>Note that Spark Streaming must always have one event arriving to progress the microbatch, so don&apos;t pause all producers!</em>
            </p>
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
