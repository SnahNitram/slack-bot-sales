// Required dependencies to be installed:
// npm install @slack/bolt axios dotenv marked

require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');
const { marked } = require('marked');

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Configure Flowise API details with chatflow ID
const FLOWISE_BASE_URL = process.env.FLOWISE_API_ENDPOINT.replace(/\/$/, ''); // Remove trailing slash if present
const FLOWISE_API_ENDPOINT = `${FLOWISE_BASE_URL}/api/v1/prediction/${process.env.FLOWISE_CHATFLOW_ID}`;

// Log the configured endpoint
console.log('Configured Flowise API endpoint:', FLOWISE_API_ENDPOINT);

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
  
  // Convert bold
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  
  // Convert italic
  text = text.replace(/_(.+?)_/g, '_$1_');
  text = text.replace(/\*([^*]+)\*/g, '_$1_');
  
  // Convert bullet points with multiple levels
  text = text.replace(/^(\s*)-\s+(.+)$/gm, (match, spaces, content) => {
    const level = Math.floor(spaces.length / 2);
    return `${'  '.repeat(level)}• ${content}`;
  });
  
  // Convert numbered lists with multiple levels
  text = text.replace(/^(\s*)\d+\.\s+(.+)$/gm, (match, spaces, content) => {
    const level = Math.floor(spaces.length / 2);
    return `${'  '.repeat(level)}• ${content}`;
  });
  
  // Convert block quotes
  text = text.replace(/^>\s+(.+)$/gm, '>>> $1');
  text = text.replace(/^>\s*$/gm, '');
  
  // Convert links
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
    if (section.startsWith('```')) {
      // Code block
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section
        }
      });
    } else if (section.startsWith('>>>')) {
      // Block quote
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section
        }
      });
    } else if (section.trim().startsWith('|') && section.includes('\n')) {
      // Table
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section
        }
      });
    } else {
      // Regular text
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
    // Log the raw response for debugging
    console.log('Raw response type:', typeof flowiseResponse);
    
    // If response is already an object, use it directly
    const responseData = (typeof flowiseResponse === 'object') 
      ? flowiseResponse 
      : JSON.parse(flowiseResponse);

    console.log('Parsed response data:', responseData);

    // First try to get text directly
    if (responseData.text) {
      return convertMarkdownToSlack(responseData.text);
    }

    // If not found, try to get from assistant messages
    if (responseData.assistant?.messages) {
      const lastMessage = responseData.assistant.messages.find(msg => msg.role === 'assistant');
      if (lastMessage?.content?.[0]?.text?.value) {
        return convertMarkdownToSlack(lastMessage.content[0].text.value);
      }
    }

    // If all else fails, return the entire response as string
    return 'Sorry, I couldn\'t process the response properly.';
  } catch (error) {
    console.error('Error parsing Flowise response:', error);
    if (typeof flowiseResponse === 'object') {
      console.error('Response object:', JSON.stringify(flowiseResponse, null, 2));
    } else if (typeof flowiseResponse === 'string') {
      console.error('First 200 characters of response:', flowiseResponse.substring(0, 200));
    }
    return 'Sorry, I had trouble processing the response.';
  }
};

// Handle mentions in channels
app.event('app_mention', async ({ event, say }) => {
  try {
    // Clean the message text (remove bot mention if present)
    const messageText = event.text.replace(`<@${app.client.botUserId}>`, '').trim();
    
    // Use thread_ts if it exists (meaning it's in a thread), otherwise use the message ts as the conversation ID
    const conversationId = event.thread_ts || event.ts;
    
    // Log the session ID for debugging
    const sessionId = `slack_${event.channel}_${conversationId}`;
    console.log('Channel mention - Making request to:', FLOWISE_API_ENDPOINT);
    console.log('With sessionId:', sessionId);

    // Call Flowise API with conversation context
    const response = await axios.post(
      FLOWISE_API_ENDPOINT,
      {
        question: messageText,
        overrideConfig: {
          sessionId: sessionId
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FLOWISE_API_KEY}`
        },
        responseType: 'json'
      }
    );

    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    console.log('Response data type:', typeof response.data);

    const cleanResponse = extractCleanResponse(response.data);
    const blocks = createSlackBlocks(cleanResponse);

    await say({
      blocks: blocks,
      text: cleanResponse,
      thread_ts: event.thread_ts || event.ts
    });

  } catch (error) {
    console.error('Full error details:', error);
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
      console.error('Error response data:', error.response.data);
    }
    await say({
      text: "I'm sorry, I encountered an error processing your request.",
      thread_ts: event.thread_ts || event.ts
    });
  }
});

// Handle direct messages
app.event('message', async ({ event, say }) => {
  // Only respond to direct messages, not channel messages
  if (event.channel_type === 'im' && !event.bot_id) {
    try {
      // Use thread_ts if it exists, otherwise use the message ts as the conversation ID
      const conversationId = event.thread_ts || event.ts;
      
      // Log the session ID for debugging
      const sessionId = `slack_dm_${event.channel}_${conversationId}`;
      console.log('Direct message - Making request to:', FLOWISE_API_ENDPOINT);
      console.log('With sessionId:', sessionId);

      const response = await axios.post(
        FLOWISE_API_ENDPOINT,
        {
          question: event.text.trim(),
          overrideConfig: {
            sessionId: sessionId
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.FLOWISE_API_KEY}`
          },
          responseType: 'json'
        }
      );

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);
      console.log('Response data type:', typeof response.data);

      const cleanResponse = extractCleanResponse(response.data);
      const blocks = createSlackBlocks(cleanResponse);

      await say({
        blocks: blocks,
        text: cleanResponse,
        thread_ts: event.thread_ts || event.ts
      });

    } catch (error) {
      console.error('Full error details:', error);
      if (error.response) {
        console.error('Error response status:', error.response.status);
        console.error('Error response headers:', error.response.headers);
        console.error('Error response data:', error.response.data);
      }
      await say({
        text: "I'm sorry, I encountered an error processing your request.",
        thread_ts: event.thread_ts || event.ts
      });
    }
  }
});

// Error handler
app.error(async (error) => {
  console.error('App error:', error);
});

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack Bolt app is running!');
    console.log('Using Flowise API endpoint:', FLOWISE_API_ENDPOINT);
  } catch (error) {
    console.error('Unable to start App:', error);
  }
})();