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

// Configure Flowise API details
const FLOWISE_API_ENDPOINT = process.env.FLOWISE_API_ENDPOINT;
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
    const responseData = typeof flowiseResponse === 'string' 
      ? JSON.parse(flowiseResponse) 
      : flowiseResponse;

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
    return 'Sorry, I had trouble processing the response.';
  }
};

// Handle direct messages and mentions
app.event('message', async ({ event, say }) => {
  if (
    (event.channel_type === 'im' || event.text.includes(`<@${app.client.botUserId}>`)) &&
    !event.bot_id
  ) {
    try {
      const messageText = event.text.replace(`<@${app.client.botUserId}>`, '').trim();

      const response = await axios.post(
        FLOWISE_API_ENDPOINT,
        {
          question: messageText
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${FLOWISE_API_KEY}`
          }
        }
      );

      const cleanResponse = extractCleanResponse(response.data);
      const blocks = createSlackBlocks(cleanResponse);

      await say({
        blocks: blocks,
        text: cleanResponse, // Fallback text
        thread_ts: event.thread_ts || event.ts
      });

    } catch (error) {
      console.error('Error:', error);
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
  } catch (error) {
    console.error('Unable to start App:', error);
  }
})();