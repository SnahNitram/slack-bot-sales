// Required dependencies to be installed:
// npm install @slack/bolt axios dotenv marked form-data

require('dotenv').config();
const { App, LogLevel } = require('@slack/bolt');
const axios = require('axios');
const { marked } = require('marked');
const { createServer } = require('http');
const FormData = require('form-data');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Initialize the Slack app with retry configuration
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  logLevel: LogLevel.WARN,
  retryConfig: {
    retries: 5,
    factor: 1.5,
    randomize: true,
    minTimeout: 2000,
    maxTimeout: 30000
  },
  rateLimitedFunctionConfig: {
    maxAttempts: 3,
    minTime: 2000
  }
});

// Store bot user ID and connection state
let botUserId = '';
let isShuttingDown = false;

// Initialize bot ID with retry logic
const initializeBotId = async () => {
  try {
    const response = await app.client.auth.test();
    botUserId = response.user_id;
    console.log(`[INFO] Bot user ID initialized: ${botUserId}`);
  } catch (error) {
    console.error('[ERROR] Failed to get bot user ID:', error);
    if (!isShuttingDown) {
      setTimeout(initializeBotId, 5000);
    }
  }
};

initializeBotId();

// Create HTTP server for health checks
const server = createServer((req, res) => {
  res.writeHead(200);
  res.end('Health check OK');
});

// Simple logging helper
const log = {
  info: (message) => {
    console.log(`[INFO] ${message}`);
  },
  error: (message, error) => {
    console.error(`[ERROR] ${message}`, error);
  },
  debug: (message) => {
    console.log(`[DEBUG] ${message}`);
  }
};

// Error handler with rate limit handling
app.error(async (error) => {
  if (isShuttingDown) return;

  log.error('App error:', error);
  
  if (error.code === 'rate_limited') {
    const retryAfter = Number(error.retryAfter) * 1000 || 30000;
    log.info(`Rate limited. Waiting ${retryAfter / 1000} seconds before retry.`);
    await new Promise(resolve => setTimeout(resolve, retryAfter));
  }
});

// Enhanced shutdown handler
process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  
  isShuttingDown = true;
  log.info('Shutting down gracefully...');
  
  try {
    await app.stop();
    server.close();
    log.info('Cleanup completed');
    process.exit(0);
  } catch (error) {
    log.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Configure Flowise API details
const FLOWISE_BASE_URL = process.env.FLOWISE_API_ENDPOINT.replace(/\/$/, '');
const FLOWISE_API_ENDPOINT = `${FLOWISE_BASE_URL}/api/v1/prediction/${process.env.FLOWISE_CHATFLOW_ID}`;
const FLOWISE_API_KEY = process.env.FLOWISE_API_KEY;

// Language mapping for code blocks
const languageMap = {
  'python': 'Python',
  'javascript': 'JavaScript',
  'js': 'JavaScript',
  'typescript': 'TypeScript',
  'ts': 'TypeScript',
  'java': 'Java',
  'cpp': 'C++',
  'c++': 'C++',
  'csharp': 'C#',
  'c#': 'C#',
  'ruby': 'Ruby',
  'php': 'PHP',
  'go': 'Go',
  'rust': 'Rust',
  'swift': 'Swift',
  'kotlin': 'Kotlin',
  'sql': 'SQL',
  'html': 'HTML',
  'css': 'CSS',
  'shell': 'Shell',
  'bash': 'Bash',
  'json': 'JSON',
  'xml': 'XML',
  'yaml': 'YAML',
  'markdown': 'Markdown',
  'md': 'Markdown'
};

// Emoji mapping for common markdown emoji codes
const emojiMap = {
  ':smile:': ':smile:',
  ':thumbsup:': ':+1:',
  ':check:': ':white_check_mark:',
  ':warning:': ':warning:',
  ':info:': ':information_source:',
  ':star:': ':star:',
  ':question:': ':question:',
  ':x:': ':x:',
  ':heavy_check_mark:': ':white_check_mark:',
  ':clipboard:': ':clipboard:'
};

// Function to convert markdown tables to Slack format
const convertTable = (tableText) => {
  const rows = tableText.trim().split('\n');
  let slackTable = '';
  
  rows.forEach((row, index) => {
    const cells = row.split('|')
      .filter(cell => cell.trim() !== '')
      .map(cell => cell.trim());
    
    // Skip markdown separator row
    if (index === 1 && row.includes('|-')) {
      return;
    }
    
    // Format header row
    if (index === 0) {
      slackTable += cells.map(cell => `*${cell}*`).join(' | ') + '\n';
      return;
    }
    
    // Format regular rows
    slackTable += cells.join(' | ') + '\n';
  });
  
  return '```' + slackTable + '```';
};

// Function to convert markdown to Slack's mrkdwn format
const convertMarkdownToSlack = (text) => {
  // Handle tables first
  text = text.replace(/(\|[^\n]+\|\n)((?:\|[-:\|\s]+\|\n))(\|[^\n]+\|\n)+/g, (match) => {
    return convertTable(match);
  });
  
  // Replace markdown code blocks with Slack code blocks
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang ? languageMap[lang.toLowerCase()] || lang : '';
    return `\`\`\`${language}\n${code}\`\`\``;
  });
  
  // Replace markdown inline code with Slack code
  text = text.replace(/`([^`]+)`/g, '`$1`');
  
  // Convert headers with different levels
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
    const level = hashes.length;
    const prefix = '*'.repeat(Math.min(level, 3));
    return `${prefix}${content}${prefix}\n`;
  });
  
  // Convert bold and italic
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  text = text.replace(/_(.+?)_/g, '_$1_');
  text = text.replace(/\*([^*]+)\*/g, '_$1_');
  
  // Convert lists
  text = text.replace(/^(\s*)-\s+(.+)$/gm, (match, spaces, content) => {
    const level = Math.floor(spaces.length / 2);
    return `${'  '.repeat(level)}• ${content}`;
  });
  text = text.replace(/^(\s*)\d+\.\s+(.+)$/gm, (match, spaces, content) => {
    const level = Math.floor(spaces.length / 2);
    return `${'  '.repeat(level)}• ${content}`;
  });
  
  // Convert block quotes and links
  text = text.replace(/^>\s+(.+)$/gm, '>>> $1');
  text = text.replace(/^>\s*$/gm, '');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  
  // Convert emoji codes
  Object.entries(emojiMap).forEach(([markdown, slack]) => {
    text = text.replace(new RegExp(markdown, 'g'), slack);
  });
  
  return text;
};

// Function to create Slack blocks for complex formatting
const createSlackBlocks = (text) => {
  const blocks = [];
  const sections = text.split('\n\n');
  
  sections.forEach(section => {
    if (section.startsWith('```') || section.startsWith('>>>') || 
        (section.trim().startsWith('|') && section.includes('\n'))) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section
        }
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section
        }
      });
    }
  });
  
  return blocks;
};

// Function to extract clean text from Flowise response
const extractCleanResponse = (flowiseResponse) => {
  try {
    log.debug(`Processing response type: ${typeof flowiseResponse}`);
    
    if (flowiseResponse && flowiseResponse.text) {
      return convertMarkdownToSlack(flowiseResponse.text);
    }

    return 'Sorry, I couldn\'t process the response properly.';
  } catch (error) {
    log.error('Error processing Flowise response:', error);
    return 'Sorry, I had trouble processing the response.';
  }
};

// Helper to check if message should be processed
const shouldProcessMessage = (event) => {
  const isDM = event.channel_type === 'im';
  const isChannel = event.channel_type === 'channel' || event.channel_type === 'group';
  const hasBotMention = event.text?.includes(`<@${botUserId}>`);
  const isInThread = !!event.thread_ts;
  const isBot = !!event.bot_id;

  log.debug(`Message evaluation:
    Message text: "${event.text}"
    Bot ID: ${botUserId}
    Channel type: ${event.channel_type}
    Is DM: ${isDM}
    Is Channel: ${isChannel}
    Has mention: ${hasBotMention}
    In thread: ${isInThread}
    Thread ts: ${event.thread_ts}
    Is bot message: ${isBot}
  `);

  // Don't process bot messages
  if (isBot) return false;
  
  // Always process DMs
  if (isDM) return true;

  // For channels, only process if:
  // 1. Message directly mentions the bot, or
  // 2. Message is in a thread where the bot has already been mentioned
  if (isChannel) {
    // Direct mention - always process
    if (hasBotMention) return true;
    
    // Thread - only process if bot was previously mentioned in the thread
    if (isInThread && event.text) {
      // We'll let the thread continue if the message has our mention
      return hasBotMention;
    }
  }

  return false;
};

// Helper function to create temp file
async function saveBufferToTemp(buffer, filename) {
  const tempPath = path.join(os.tmpdir(), `slack-${Date.now()}-${filename}`);
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

// Add a validation function
function validateFlowiseConfig() {
  if (!FLOWISE_API_ENDPOINT) {
    throw new Error('FLOWISE_API_ENDPOINT is not configured');
  }
  if (!FLOWISE_API_KEY) {
    throw new Error('FLOWISE_API_KEY is not configured');
  }
  
  // Validate URL format
  try {
    new URL(FLOWISE_API_ENDPOINT);
  } catch (e) {
    throw new Error(`Invalid FLOWISE_API_ENDPOINT format: ${FLOWISE_API_ENDPOINT}`);
  }
}

// Update the handleMessage function
const handleMessage = async (text, files = null, client = null) => {
  try {
    validateFlowiseConfig();
    
    // If there are files, handle them according to Flowise docs
    if (files && files.length > 0 && client) {
      const file = files[0];
      
      // Get full file info from Slack
      const fileInfo = await client.files.info({
        file: file.id
      });

      log.debug('File information:', {
        name: fileInfo.file.name,
        type: fileInfo.file.mimetype,
        hasUrl: !!fileInfo.file.url_private,
        size: fileInfo.file.size
      });

      // Download file with proper error handling
      const fileResponse = await axios({
        method: 'get',
        url: fileInfo.file.url_private,
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        },
        responseType: 'arraybuffer'
      });

      // Convert to base64 and prepare the upload format according to Flowise docs
      const base64File = Buffer.from(fileResponse.data).toString('base64');
      
      // Send to Flowise using their documented format
      const response = await axios({
        method: 'post',
        url: FLOWISE_API_ENDPOINT,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${FLOWISE_API_KEY}`
        },
        data: {
          question: text || "Process this file",
          uploads: [{
            data: `data:${fileInfo.file.mimetype};base64,${base64File}`,
            type: 'file',
            name: fileInfo.file.name,
            mime: fileInfo.file.mimetype
          }]
        }
      });

      return response.data;
    }

    // Regular text message without files
    const response = await axios({
      method: 'post',
      url: FLOWISE_API_ENDPOINT,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FLOWISE_API_KEY}`
      },
      data: {
        question: text
      }
    });

    return response.data;
  } catch (error) {
    log.error('Error in handleMessage:', {
      error: error.message,
      code: error.code,
      url: FLOWISE_API_ENDPOINT,
      stack: error.stack
    });
    throw error;
  }
};

// Update the message event handler
app.message(async ({ message, say, client }) => {
  try {
    // Get bot's own info if we haven't already
    if (!botUserId) {
      const authResult = await client.auth.test();
      botUserId = authResult.user_id;
    }

    // Determine if this is a channel or DM
    const isDM = message.channel_type === 'im';
    const isChannel = message.channel_type === 'channel' || message.channel_type === 'group';
    
    // Check if message is from a bot (including ourselves)
    if (message.bot_id || message.subtype === 'bot_message') {
      return;
    }

    // Get message text and any file attachments
    const messageText = message.text || '';
    const hasMention = messageText.includes(`<@${botUserId}>`);
    const inThread = !!message.thread_ts;
    
    // Log message evaluation for debugging
    log.debug('Message evaluation:', {
      'Message text': messageText,
      'Bot ID': botUserId,
      'Channel type': message.channel_type,
      'Is DM': isDM,
      'Is Channel': isChannel,
      'Has mention': hasMention,
      'In thread': inThread,
      'Thread ts': message.thread_ts,
      'Is bot message': !!message.bot_id
    });

    // Determine if we should respond
    const shouldRespond = 
      isDM || // Always respond in DMs
      (isChannel && hasMention) || // Respond in channels when mentioned
      (inThread && message.thread_ts && await isThreadParticipant(message.thread_ts, client, message.channel, botUserId)); // Respond in threads we're part of

    if (!shouldRespond) {
      log.debug('Skipping message - does not meet response criteria');
      return;
    }

    log.info(`Processing message in ${message.channel_type}`);

    // Pass the client to handleMessage
    const response = await handleMessage(messageText, message.files, client);
    
    // Send the response
    await say({
      text: extractCleanResponse(response),
      thread_ts: message.thread_ts || message.ts
    });

    log.info('Successfully sent response');

  } catch (error) {
    log.error('Error handling message:', error);
    await say({
      text: "I'm sorry, I encountered an error processing your message. Please try again later.",
      thread_ts: message.thread_ts || message.ts
    });
  }
});

// Helper function to check if bot is part of a thread
async function isThreadParticipant(threadTs, client, channel, botUserId) {
  try {
    const result = await client.conversations.replies({
      channel: channel,
      ts: threadTs
    });
    
    return result.messages.some(msg => 
      msg.user === botUserId || 
      (msg.bot_id && msg.username === process.env.SLACK_BOT_USERNAME)
    );
  } catch (error) {
    log.error('Error checking thread participation:', error);
    return false;
  }
}

// Update the file_shared event handler to include more error handling
app.event('file_shared', async ({ event, client }) => {
  try {
    log.debug('File shared event received:', event);
    
    const fileInfo = await client.files.info({
      file: event.file_id
    });

    log.debug('File info retrieved:', {
      name: fileInfo.file.name,
      type: fileInfo.file.mimetype,
      hasUrl: !!fileInfo.file.url_private
    });

    const response = await handleMessage(null, [fileInfo.file]);
    
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: extractCleanResponse(response)
    });
  } catch (error) {
    log.error('Error handling file:', error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: "I'm sorry, I encountered an error processing your file. Please try again later."
    });
  }
});

// Start the app
(async () => {
  try {
    await app.start();
    server.listen(process.env.PORT || 3000);
    log.info('⚡️ Slack Bolt app and health check server are running!');
  } catch (error) {
    log.error('Unable to start App:', error);
    process.exit(1);
  }
})();