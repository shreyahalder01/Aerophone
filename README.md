# Aerophone — Gesture Theremin

A web-based gesture-controlled instrument inspired by the theremin, featuring a modern instrument panel interface with real-time audio synthesis.

## Overview

Aerophone is an interactive web application that turns your gestures (mouse or touch) into musical sounds. The interface features a walnut-textured instrument panel with a signature oscilloscope-style display, combining retro aesthetics with modern web technology.

## Features

- **Gesture-Based Control**: Move your cursor or touch input to generate and modulate sounds
- **Visual Feedback**: Real-time oscilloscope display showing the audio waveform
- **Custom Styling**: Warm, vintage instrument aesthetic with wooden panels and brass accents
- **Responsive Design**: Adapts to different screen sizes while maintaining the instrument appearance
- **Accessibility**: Keyboard navigation support and focus indicators

## Getting Started

### Prerequisites

- Modern web browser (Chrome, Firefox, Safari, or Edge)
- A local or hosted web server for the app files

### Running Locally

1. Start a simple static server from the project folder:
   - Python: `python -m http.server 8000`
   - Or any other static file server
2. Open `http://localhost:8000/aerophone-gesture-instrument.html` in your browser
3. Click the start button to allow camera access and begin playing the instrument
4. Move your hand or cursor to control pitch, volume, and tone

> Camera and audio access require the app to run on `http://localhost` or `https://` rather than a plain `file://` page.

### Deploying

Aerophone is a static web app, so it can be deployed to any host that serves files over HTTPS.

#### Option 1: GitHub Pages

1. Push the project files to a GitHub repository
2. Open the repository settings and go to Pages
3. Select the branch and folder to publish (usually `main` and `/root`)
4. Wait for the site to build and open the published URL

#### Option 2: Netlify or Vercel

1. Create a new site from the repository or upload the project folder
2. Use the default static-site settings
3. Deploy the project
4. Open the generated URL and allow camera access when prompted

#### Option 3: Any static hosting provider

Upload the following files to the hosting root:
- `aerophone-gesture-instrument.html`
- `styles.css`
- `script.js`

Make sure the site is served over HTTPS for camera permissions to work correctly.

## File Structure

- `aerophone-gesture-instrument.html` - Main HTML structure
- `styles.css` - Application styling
- `script.js` - Instrument logic, hand tracking, and audio synthesis

## Browser Compatibility

- Chrome/Chromium 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## License

Open source project.

## Contributing

Contributions are welcome! Feel free to fork and submit pull requests.
