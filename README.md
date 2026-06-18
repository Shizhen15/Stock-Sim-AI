# Stock Sim AI

Stock Sim AI is a browser-based stock trading simulation demo with a small Node.js server and simulator tests.

## Requirements

- Node.js 18 or newer
- npm

## Getting Started

Install dependencies if the project adds any in the future:

```bash
npm install
```

Start the local server:

```bash
npm start
```

Run the simulator tests:

```bash
npm test
```

## Project Structure

```text
.
├── index.html
├── package.json
├── server.mjs
├── src/
│   ├── app.js
│   ├── simulator.js
│   └── styles.css
└── tests/
    └── simulator.test.mjs
```

## Notes

- Keep local `.env` files out of Git.
- Keep generated output such as coverage reports and build artifacts untracked.
