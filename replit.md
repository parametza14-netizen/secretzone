# Discord Voice Channel Lock Bot

## Overview
This is a Discord bot application that allows users with specific roles to lock and unlock voice channels. The bot includes a web server for keep-alive functionality and provides embed notifications for channel status changes.

## Project Architecture
- **Main Bot**: `index.js` - Discord bot with voice channel management commands
- **Web Server**: `server.js` - Express server for monitoring and keep-alive functionality
- **Dependencies**: discord.js (v14.11.0), express (v4.18.2), dotenv

## Setup Requirements
The bot requires two environment variables to be configured in Replit Secrets:
1. `TOKEN` - Discord bot token from Discord Developer Portal
2. `LOG_CHANNEL_ID` - Discord channel ID for logging bot activities

## Features
- **!lockvc** - Locks the voice channel (prevents new joins)
- **!unlockvc** - Unlocks the voice channel (allows joins)
- Role-based permissions (default: "หลวงปู่เค็ม")
- Embed notifications with timestamps
- Automatic logging to specified channel

## Replit Configuration
- **Port**: 5000 (configured for Replit environment)
- **Host**: 0.0.0.0 (allows proxy access)
- **Deployment**: VM target for persistent bot operation
- **Workflow**: "Discord Bot" running `npm start`

## Recent Changes (Sep 22, 2025)
- Imported from GitHub repository
- Added missing dotenv dependency
- Updated server configuration for Replit environment (port 5000, host 0.0.0.0)
- Configured deployment settings for production
- Set up workflow for continuous operation

## User Preferences
- Maintain Thai language comments and messages in code
- Keep existing bot functionality and commands unchanged
- Use VM deployment for 24/7 bot operation