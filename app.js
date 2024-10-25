// Required dependencies to be installed:
// npm install @slack/bolt axios dotenv

require('dotenv').config();
const { App } = require('@slack/bolt');
const axios = require('axios');

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

// Handle direct messages and mentions
app.event('message', async ({ event, say }) => {
  // Only respond to messages in DMs or when mentioned
  if (
    (event.channel_type === 'im' || event.text.includes(`<@${app.client.botUserId}>`)) &&
    !event.bot_id // Prevent responding to other bots
  ) {
    try {
      // Clean the message text (remove bot mention if present)
      const messageText = event.text.replace(`<@${app.client.botUserId}>`, '').trim();

      // Call Flowise API
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

      // Send the response back to Slack
      await say({
        text: response.data,
        thread_ts: event.thread_ts || event.ts // Maintain thread context if applicable
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