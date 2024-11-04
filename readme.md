# Slack Bot with Flowise Integration

A Slack bot that integrates with Flowise to provide AI-powered chat capabilities. The bot supports direct messages, channel mentions, maintains conversation context in threads, and handles file uploads.

## Features

- 🤖 Seamless integration with Flowise AI
- 💬 Supports direct messages and channel interactions
- 🧵 Maintains conversation context in threads
- 📝 Markdown support for formatted responses
- 📎 File upload and processing support
- 🏃‍♂️ Built for performance with Socket Mode
- 🔄 Automatic reconnection handling
- 💪 Health check endpoint for reliable hosting
- 🌐 Multi-workspace ready

## Behavior

### Channel Interactions
- Responds when directly mentioned (@bot-name)
- Only continues thread conversations when mentioned
- Must be invited to channels to function
- Processes uploaded files when mentioned

### Direct Messages
- Responds to all DMs
- Maintains conversation context
- No mention needed
- Handles file uploads automatically

### Thread Handling
- Creates threaded conversations
- Maintains context within threads
- Requires mention for continued conversation
- Supports file processing in threads

## Setup

### Prerequisites
- Node.js 16 or higher
- A Slack workspace with admin access
- A Flowise instance
- [Render](https://render.com/) account (or similar hosting platform)

### Environment Variables
```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
FLOWISE_API_ENDPOINT=your-flowise-endpoint
FLOWISE_API_KEY=your-flowise-api-key
FLOWISE_CHATFLOW_ID=your-chatflow-id
```

### Installation Steps

1. Create a Slack App:
   ```bash
   # Visit api.slack.com/apps
   - Create New App
   - From scratch
   - Add required scopes (see below)
   - Enable Socket Mode
   - Install to workspace
   ```

2. Configure Required Scopes:
   - `chat:write`
   - `app_mentions:read`
   - `im:history`
   - `im:read`
   - `im:write`
   - `files:read`
   - `files:write`

3. Clone and Install:
   ```bash
   git clone [your-repo-url]
   cd [your-repo-name]
   npm install
   ```

4. Create `.env` file with required environment variables

5. Run the bot:
   ```bash
   npm start
   ```

### Hosting on Render

1. Create a new Web Service
2. Connect your GitHub repository
3. Add environment variables
4. Set build command: `npm install`
5. Set start command: `npm start`

## Distribution to Other Teams

To allow other teams to install your bot:

1. Configure OAuth & URLs in Slack App settings:
   ```
   https://your-app-name.onrender.com/slack/oauth_redirect
   https://your-app-name.onrender.com/slack/install
   https://your-app-name.onrender.com/slack/oauth
   ```

2. Enable distribution in Slack App settings
3. Share the "Add to Slack" button

## Development

### Project Structure
```
├── app.js              # Main application file
├── package.json        # Dependencies and scripts
├── .env               # Environment variables (not in repo)
├── .gitignore         # Git ignore file
└── README.md          # Documentation
```

### Dependencies
- `@slack/bolt`: Slack app framework
- `axios`: HTTP client
- `dotenv`: Environment variable management
- `marked`: Markdown processing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request