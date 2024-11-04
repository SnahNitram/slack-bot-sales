// Required dependencies to be installed:
// npm install @slack/bolt axios dotenv marked form-data

require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');
const { marked } = require('marked');
const { createServer } = require('http');
const FormData = require('form-data');

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Store bot user ID
let botUserId = '';

// Initialize bot ID
app.client.auth.test().then(response => {
    botUserId = response.user_id;
    console.log(`[INFO] Bot user ID initialized: ${botUserId}`);
}).catch(error => {
    console.error('[ERROR] Failed to get bot user ID:', error);
});

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

// Simplified shutdown handler
process.on('SIGTERM', async () => {
  log.info('Shutting down...');
  await app.stop();
  server.close();
  process.exit(0);
});

// Configure Flowise API details
const FLOWISE_BASE_URL = process.env.FLOWISE_API_ENDPOINT.replace(/\/$/, '');
const FLOWISE_API_ENDPOINT = `${FLOWISE_BASE_URL}/api/v1/prediction/${process.env.FLOWISE_CHATFLOW_ID}`;

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

// Handle messages
app.event('message', async ({ event, say }) => {
  try {
    log.debug(`Received message event in ${event.channel_type}`);

    if (!shouldProcessMessage(event)) {
      log.debug('Skipping message - does not meet processing criteria');
      return;
    }

    log.info(`Processing message in ${event.channel_type}`);

    // Clean the message text (remove bot mention if present)
    const messageText = event.text?.replace(`<@${botUserId}>`, '').trim() || '';
    
    // Use thread_ts for conversation context
    const conversationId = event.thread_ts || event.ts;
    
    // Create session ID based on channel type
    const sessionId = event.channel_type === 'im' 
      ? `slack_dm_${event.channel}_${conversationId}`
      : `slack_${event.channel}_${conversationId}`;

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

    log.debug(`API response received:
      Status: ${response.status}
      Has text: ${!!response.data?.text}
    `);

    const cleanResponse = extractCleanResponse(response.data);
    const blocks = createSlackBlocks(cleanResponse);

    await say({
      blocks: blocks,
      text: cleanResponse,
      thread_ts: event.thread_ts || event.ts
    });

    log.info('Successfully sent response');

    if (event.files && event.files.length > 0) {
      // Handle files attached to messages
      const file = event.files[0];
      const fileResponse = await axios({
        method: 'get',
        url: file.url_private,
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
        },
        responseType: 'arraybuffer'
      });

      const formData = new FormData();
      formData.append('file', new Blob([fileResponse.data]), file.name);
      formData.append('question', messageText || 'Process this file');
      
      // Update your Flowise request to use formData
      const flowiseResponse = await axios({
        method: 'post',
        url: FLOWISE_API_ENDPOINT,
        data: formData,
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${process.env.FLOWISE_API_KEY}`
        }
      });

      // Send response back to Slack
      await say({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: extractCleanResponse(flowiseResponse.data)
      });
    }

  } catch (error) {
    log.error('Error handling message:', error);
    await say({
      text: "I'm sorry, I encountered an error processing your request. Please try again later.",
      thread_ts: event.thread_ts || event.ts
    });
  }
});

// Handle file uploads
app.event('file_shared', async ({ event, client }) => {
  try {
    // Get file information
    const fileInfo = await client.files.info({
      file: event.file_id
    });

    // Download the file
    const fileResponse = await axios({
      method: 'get',
      url: fileInfo.file.url_private,
      headers: {
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      responseType: 'arraybuffer'
    });

    // Create form data for Flowise
    const formData = new FormData();
    formData.append('file', new Blob([fileResponse.data]), fileInfo.file.name);
    formData.append('question', 'Process this file');

    // Send to Flowise
    const flowiseResponse = await axios({
      method: 'post',
      url: FLOWISE_API_ENDPOINT,
      data: formData,
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${process.env.FLOWISE_API_KEY}`
      }
    });

    // Send response back to Slack
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: extractCleanResponse(flowiseResponse.data)
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

// Error handler
app.error(async (error) => {
  log.error('App error:', error);
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