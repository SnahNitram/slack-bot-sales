// Required dependencies to be installed:
// npm install @slack/bolt axios dotenv marked

require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');
const { marked } = require('marked');
const { createServer } = require('http');

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Create HTTP server for health checks
const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('Health check OK');
});

// Structured logging helper
const log = {
  info: (message, data = {}) => {
    console.log(JSON.stringify({ level: 'info', message, ...data, timestamp: new Date().toISOString() }));
  },
  error: (message, error = {}, data = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error.message || error,
      stack: error.stack,
      ...data,
      timestamp: new Date().toISOString()
    }));
  },
  debug: (message, data = {}) => {
    console.log(JSON.stringify({ level: 'debug', message, ...data, timestamp: new Date().toISOString() }));
  }
};

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  log.info('SIGTERM received, shutting down...');
  await app.stop();
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  log.info('SIGINT received, shutting down...');
  await app.stop();
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
});

// Configure Flowise API details with chatflow ID
const FLOWISE_BASE_URL = process.env.FLOWISE_API_ENDPOINT.replace(/\/$/, '');
const FLOWISE_API_ENDPOINT = `${FLOWISE_BASE_URL}/api/v1/prediction/${process.env.FLOWISE_CHATFLOW_ID}`;

log.info('Configured Flowise API endpoint', { endpoint: FLOWISE_API_ENDPOINT });

[... Keep all the existing helper functions (languageMap, emojiMap, convertTable, convertMarkdownToSlack, createSlackBlocks) unchanged ...]

// Function to extract clean text from Flowise response
const extractCleanResponse = (flowiseResponse) => {
  try {
    log.debug('Processing Flowise response', {
      responseType: typeof flowiseResponse,
      hasText: flowiseResponse?.text ? 'yes' : 'no'
    });
    
    if (flowiseResponse && flowiseResponse.text) {
      return convertMarkdownToSlack(flowiseResponse.text);
    }

    return 'Sorry, I couldn\'t process the response properly.';
  } catch (error) {
    log.error('Error processing Flowise response', error, { rawResponse: flowiseResponse });
    return 'Sorry, I had trouble processing the response.';
  }
};

// Helper to check if message should be processed
const shouldProcessMessage = (event) => {
  const isDM = event.channel_type === 'im';
  const isChannel = event.channel_type === 'channel' || event.channel_type === 'group';
  const hasBotMention = event.text?.includes(`<@${app.client.botUserId}>`);
  const isInThread = !!event.thread_ts;
  const isBot = !!event.bot_id;

  // Don't process bot messages
  if (isBot) return false;

  // Process all DM messages
  if (isDM) return true;

  // In channels, process if:
  // 1. Message mentions the bot, or
  // 2. Message is in a thread and parent message mentioned the bot
  if (isChannel && (hasBotMention || isInThread)) return true;

  return false;
};

// Handle all messages (both channel messages and DMs)
app.event('message', async ({ event, say }) => {
  try {
    log.debug('Received message event', {
      channelType: event.channel_type,
      hasThreadTs: !!event.thread_ts,
      hasBotMention: event.text?.includes(`<@${app.client.botUserId}>`),
      isBot: !!event.bot_id,
      channel: event.channel,
      threadTs: event.thread_ts
    });

    if (!shouldProcessMessage(event)) {
      log.debug('Skipping message - does not meet processing criteria', {
        channelType: event.channel_type,
        hasThreadTs: !!event.thread_ts
      });
      return;
    }

    log.info('Processing message', {
      channelType: event.channel_type,
      channel: event.channel,
      threadTs: event.thread_ts
    });

    // Clean the message text (remove bot mention if present)
    const messageText = event.text?.replace(`<@${app.client.botUserId}>`, '').trim() || '';
    
    // Use thread_ts for conversation context
    const conversationId = event.thread_ts || event.ts;
    
    // Create session ID based on channel type
    const sessionId = event.channel_type === 'im' 
      ? `slack_dm_${event.channel}_${conversationId}`
      : `slack_${event.channel}_${conversationId}`;

    log.debug('Making Flowise API request', {
      sessionId,
      messageLength: messageText.length
    });

    // Make API request to Flowise
    const response = await axios({
      method: 'post',
      url: FLOWISE_API_ENDPOINT,
      data: {
        question: messageText,
        overrideConfig: {
          sessionId: sessionId
        }
      },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.FLOWISE_API_KEY}`
      },
      validateStatus: (status) => status === 200
    });

    log.debug('Received Flowise response', {
      status: response.status,
      dataType: typeof response.data,
      hasText: response.data && response.data.text ? 'yes' : 'no'
    });

    const cleanResponse = extractCleanResponse(response.data);
    const blocks = createSlackBlocks(cleanResponse);

    await say({
      blocks: blocks,
      text: cleanResponse,
      thread_ts: event.thread_ts || event.ts
    });

    log.info('Successfully sent response', {
      channel: event.channel,
      threadTs: event.thread_ts || event.ts
    });

  } catch (error) {
    log.error('Error handling message', error, {
      channel: event.channel,
      threadTs: event.thread_ts
    });

    if (error.response) {
      log.error('API error details', null, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }

    await say({
      text: "I'm sorry, I encountered an error processing your request. Please try again later.",
      thread_ts: event.thread_ts || event.ts
    });
  }
});

// Error handler
app.error(async (error) => {
  log.error('App error', error);
});

// Start the app
(async () => {
  try {
    // Start both the Slack app and HTTP server
    await app.start();
    server.listen(process.env.PORT || 3000);
    log.info('Slack bot started', {
      port: process.env.PORT || 3000,
      endpoint: FLOWISE_API_ENDPOINT
    });
  } catch (error) {
    log.error('Unable to start App', error);
    process.exit(1);
  }
})();