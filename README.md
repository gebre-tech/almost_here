# Almost Here

![Project Status](https://img.shields.io/badge/status-in%20development-orange)## Overview

Almost Here is a secure, privacy-focused mobile messaging application designed to provide robust end-to-end (E2E) encryption, forward secrecy, and advanced cryptographic security using the Noise Protocol Framework. Built for modern mobile users, it ensures secure, real-time communication with a seamless user experience. The backend leverages Django, PostgreSQL, Redis, and Django Channels for high-performance WebSocket-based messaging, while the frontend is developed using React Native with Expo for cross-platform compatibility.

## Features

- **End-to-End Encryption**: All messages are encrypted using the Noise Protocol, ensuring only intended recipients can read them.
- **Forward Secrecy**: Session keys are ephemeral, protecting past communications even if long-term keys are compromised.
- **Real-Time Messaging**: Powered by Django Channels and WebSockets for instant message delivery.
- **Cross-Platform Support**: Built with React Native and Expo for iOS and Android compatibility.
- **Scalable Backend**: Utilizes Redis for caching and PostgreSQL for persistent storage, ensuring performance under load.
- **User-Friendly Interface**: Intuitive design for secure chats, group messaging, and media sharing.

## Tech Stack

- **Frontend**:
  - React Native
  - Expo
- **Backend**:
  - Django (Python web framework)
  - PostgreSQL (relational database)
  - Redis (caching and in-memory operations)
  - Django Channels (WebSocket support)
- **Cryptography**:
  - Noise Protocol Framework (advanced E2E encryption and forward secrecy)
- **Other Tools**:
  - Render (cloud hosting for backend/server)
  - GitHub Actions (CI/CD)

## Getting Started

### Prerequisites

- Node.js v18+ (for React Native and Expo)
- Python 3.10+ (for Django backend)
- PostgreSQL 15+
- Redis 7+
- Docker (optional, for containerized setup)
- Expo CLI (`npm install -g expo-cli`)
- GitHub account for cloning the repository

### Installation

1. **Clone the Repository**:

   ```bash
   git clone https://github.com/gebre-tech/almost_here.git
   cd almost_here
   ```

2. **Set Up Backend**:

   - Install Python dependencies:

     ```bash
     pip install -r message/requirements.txt
     ```
   - Configure environment variables by creating a `.env` file in the `message/` directory:

     ```env
     DATABASE_URL=postgresql://user:password@localhost:5432/almost_here
     REDIS_URL=redis://localhost:6379/0
     SECRET_KEY=your_django_secret_key
     NOISE_PROTOCOL_CONFIG=Noise_XK_25519_ChaChaPoly_BLAKE2s
     ```
   - Apply database migrations:

     ```bash
     python message/manage.py migrate
     ```
   - Start the Django development server with Channels:

     ```bash
     python message/manage.py runserver
     ```

3. **Set Up Frontend**:

   - Navigate to the frontend directory and install dependencies:

     ```bash
     cd frontend
     npm install
     ```
   - Start the Expo development server:

     ```bash
     npx expo start
     ```
   - Scan the QR code with the Expo Go app on your iOS/Android device or run in an emulator.

4. **Optional: Run with Docker**:

   - Build and start containers:

     ```bash
     docker-compose up --build
     ```

### Usage

- **Access the App**:
  - Open the Expo Go app on your mobile device and scan the QR code from the Expo dev server.
  - Alternatively, access the backend API at `http://localhost:8000` for testing.
- **Create an Account**:
  - Register a new user via the mobile app’s signup screen.
  - Log in to start secure messaging with E2E encryption.
- **Send Messages**:
  - Initiate chats, create groups, or share media, all secured by the Noise Protocol.

## Security

Almost Here prioritizes security. If you discover a vulnerability:

- Do not disclose it publicly.
- Email the maintainer directly at \[your-email@example.com\] with details.
- We’ll acknowledge and address the issue promptly.

## Contact

For questions, feedback, or support:

- **Maintainer**: Gebre Tech (@gebre-tech)
- **Issues**: File an issue on the GitHub Issues page
- Phone: +2519-285-103-23

## Acknowledgments

- The Noise Protocol Framework team for their groundbreaking work on secure cryptography.
- The Django, React Native, and Expo communities for their robust tools and documentation.
- Open-source contributors for inspiring secure and scalable software solutions.
