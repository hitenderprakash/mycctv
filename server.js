const express = require('express');
const { spawn } = require('child_process'); // For running FFmpeg
const jwt = require('jsonwebtoken');        // For JSON Web Tokens
const Redis = require('ioredis');           // For interacting with Redis
const app = express();
const port = process.env.PORT || 8080;      // Get port from environment or default

// --- IMPORTANT: CONFIGURE YOUR WEBCAM AND OS HERE ---
let FFMPEG_COMMAND;
let FFMPEG_ARGS;

// --- Example for Linux (most common for /dev/video2) ---
// Make sure /dev/video2 is your actual webcam device path.
FFMPEG_COMMAND = 'ffmpeg';
FFMPEG_ARGS = [
    '-f', 'v4l2',          // Input format for Linux webcams
    '-i', '/dev/video2',   // !!! YOUR WEBCAM DEVICE PATH HERE !!!
    '-f', 'mjpeg',         // Output format: Motion JPEG
    '-q:v', '5',           // Video quality (1=best, 31=worst)
    '-pix_fmt', 'yuvj422p', // Pixel format for MJPEG
    '-vcodec', 'mjpeg',    // Force MJPEG video codec
    '-an',                 // No audio
    '-'                    // Output to stdout (where Node.js will read it)
];

// --- IMPORTANT: Check if FFmpeg config is set ---
if (!FFMPEG_COMMAND || !FFMPEG_ARGS) {
    console.error('ERROR: FFmpeg configuration is missing. Please uncomment and configure the FFMPEG_COMMAND and FFMPEG_ARGS for your OS and webcam.');
    process.exit(1);
}

// --- Middleware to parse JSON request bodies (needed for /login POST) ---
app.use(express.json());

// --- Load Environment Variables for Authentication and Redis ---
const JWT_SECRET = process.env.JWT_SECRET;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost'; // Use REDIS_HOST from env
const REDIS_PORT = process.env.REDIS_PORT || 6379;       // Use REDIS_PORT from env

if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET environment variable is not set!');
    console.error('Please ensure it is set in your docker-compose.yml (e.g., JWT_SECRET=your_strong_secret)');
    process.exit(1);
}

// --- Initialize Redis Client ---
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT
});

redis.on('connect', () => console.log('Connected to Redis!'));
redis.on('error', (err) => console.error('Redis Client Error:', err));

// --- Function to "Seed" Dummy Users into Redis (for first run) ---
async function seedDummyUsers() {
    const dummyUsers = [
        //{ id: 'user1', username: 'user', password: 'password' } 
        //to be replaced with actual DB and proper ways to register users 
    ];

    for (const user of dummyUsers) {
        const exists = await redis.exists(`user:${user.username}`);
        if (!exists) {
            await redis.hmset(`user:${user.username}`, 'id', user.id, 'username', user.username, 'password', user.password);
            console.log(`Seeded user: ${user.username} into Redis`);
        } else {
            console.log(`User ${user.username} already exists in Redis.`);
        }
    }
}

// Call seed function when app starts
seedDummyUsers().catch(err => console.error("Error seeding users:", err));

// --- LOGIN ROUTE: To get an Authentication Token (API endpoint) ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const userData = await redis.hgetall(`user:${username}`);

    if (userData && userData.password === password) { // Simple password check for demo
        const accessToken = jwt.sign(
            { id: userData.id, username: userData.username },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        res.json({ accessToken: accessToken, message: 'Login successful!' }); // Send message back
    } else {
        res.status(401).json({ message: 'Invalid username or password' }); // Send JSON error message
    }
});

// --- AUTHENTICATION MIDDLEWARE ---
// This function will check for a valid JWT in incoming requests.
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        // For API endpoints, send 401. The client-side code on /stream-page will handle redirect.
        return res.status(401).json({ message: 'Unauthorized: No token provided.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Forbidden: Invalid or expired token.' });
        }
        req.user = user; // Attach decoded user info to the request
        next(); // Proceed to the next route handler
    });
}

// --- 1. HOME PAGE REDIRECT TO LOGIN ---
// If a user hits the root URL, they are redirected to the login page.
app.get('/', (req, res) => {
    res.redirect('/login');
});

// --- 2. LOGIN PAGE: Serves the HTML form ---
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Login to CCTV Stream</title>
            <style>
                body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background-color: #f0f0f0; margin: 0; }
                .login-container { background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); text-align: center; }
                h1 { color: #333; margin-bottom: 20px; }
                input[type="text"], input[type="password"] {
                    width: calc(100% - 20px);
                    padding: 10px;
                    margin-bottom: 15px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                button {
                    background-color: #007bff;
                    color: white;
                    padding: 10px 20px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 1em;
                }
                button:hover {
                    background-color: #0056b3;
                }
                #message {
                    color: red;
                    margin-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <h1>Login to Access Stream</h1>
                <form id="loginForm">
                    <input type="text" id="username" placeholder="Username (e.g., testuser)" required><br>
                    <input type="password" id="password" placeholder="Password (e.g., testpassword)" required><br>
                    <button type="submit">Login</button>
                </form>
                <p id="message"></p>
                <p>Test credentials: <code>testuser</code> / <code>testpassword</code></p>
            </div>

            <script>
                document.getElementById('loginForm').addEventListener('submit', async (event) => {
                    event.preventDefault(); // Prevent default form submission

                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;
                    const messageElement = document.getElementById('message');

                    try {
                        const response = await fetch('/login', { // POST to the /login API endpoint
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ username, password })
                        });

                        const data = await response.json();

                        if (response.ok) {
                            localStorage.setItem('accessToken', data.accessToken); // Store the token
                            messageElement.style.color = 'green';
                            messageElement.textContent = 'Login successful! Redirecting...';
                            // Redirect to the protected stream page
                            window.location.href = '/stream-page';
                        } else {
                            messageElement.style.color = 'red';
                            messageElement.textContent = data.message || 'Login failed.';
                        }
                    } catch (error) {
                        messageElement.style.color = 'red';
                        messageElement.textContent = 'Network error or server unavailable.';
                        console.error('Login error:', error);
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// --- 3. PROTECTED STREAM PAGE (HTML) ---
// This page requires authentication and will embed the raw MJPEG stream.
app.get('/stream-page', authenticateToken, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>CCTV Live Stream</title>
            <style>
                body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background-color: #f0f0f0; margin: 0; }
                h1 { color: #333; }
                #streamImg { border: 2px solid #333; max-width: 90%; height: auto; display: block; margin-top: 20px; }
                p { margin-top: 10px; color: #555; }
                .logout-button { margin-top: 20px; padding: 10px 20px; background-color: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; }
                .logout-button:hover { background-color: #c82333; }
            </style>
        </head>
        <body>
            <h1>Live Webcam Stream for ${req.user.username} </h1>
            <img id="streamImg" alt="Webcam Stream" />
            <p>If the stream doesn't load, ensure your webcam is properly connected and configured, and you are authenticated.</p>
            <button class="logout-button" onclick="localStorage.removeItem('accessToken'); window.location.href = '/login';">Logout</button>

            <script>
                // This script fetches the raw MJPEG stream with the Authorization header
                const streamImg = document.getElementById('streamImg');
                const accessToken = localStorage.getItem('accessToken');

                if (accessToken) {
                    // For MJPEG streams, directly setting img.src to the stream URL often works
                    // with browsers, as the browser *might* send the necessary credentials if the image
                    // request is from the same origin.
                    // However, for explicit control and error handling, XHR/Fetch is better.

                    // Let's try the simpler approach for now, as browsers might handle this.
                    // If this fails, we'd need to use XHR/Fetch as commented out below.
                    //streamImg.src = '/stream'; // Browser will hopefully send current domain's cookies/headers if applicable
                                               // But for pure Authorization header, direct img.src is limited.

                    // For a more robust solution that explicitly sends Authorization header with the image:
                    /*
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', '/stream');
                    xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
                    xhr.responseType = 'blob'; // Get the response as a Blob (for the image)

                    xhr.onload = function() {
                        if (this.status === 200) {
                            const blob = this.response;
                            const imgUrl = URL.createObjectURL(blob);
                            streamImg.src = imgUrl;
                        } else {
                            console.error('Failed to load stream:', this.status, this.statusText);
                            localStorage.removeItem('accessToken'); // Clear invalid token
                            alert('Session expired or unauthorized. Please log in again.');
                            window.location.href = '/login';
                        }
                    };
                    xhr.onerror = function() {
                        console.error('Network error during stream load.');
                        alert('Network error during stream load. Please try again.');
                        localStorage.removeItem('accessToken'); // Clear token
                        window.location.href = '/login';
                    };
                    xhr.send();
                    */
                    // Note: Browsers generally don't send custom headers like 'Authorization' with <img> tags directly.
                    // The above XHR/Fetch approach is the standard way. However, MJPEG streams
                    // can sometimes be a special case or require a websocket if you truly want to push frames.
                    // For now, if the direct img.src doesn't send the token, it will fail at the backend.

                } else {
                    // No token found in localStorage, redirect to login page
                    alert('You are not logged in. Redirecting to login.');
                    window.location.href = '/login';
                }
            </script>
        </body>
        </html>
    `); // <-- CRUCIAL: ENSURE THIS IS THE LAST LINE OF THE HTML BLOCK
});


// --- RAW MJPEG STREAM ENDPOINT (PROTECTED) ---
// This is the actual endpoint that FFmpeg pipes to.
// It is protected by the authenticateToken middleware.

//this is to be authenticated, currently testing in browser and it does not pass the custom headers so commenting it
//app.get('/stream', authenticateToken, (req, res) => {
app.get('/stream', (req, res) => {
    //console.log(`Client ${req.user.username} connected to raw /stream data.`);

    const BOUNDARY = 'myboundary';
    res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    });

    const ffmpegProcess = spawn(FFMPEG_COMMAND, FFMPEG_ARGS);

    ffmpegProcess.stdout.on('data', (data) => {
        if (res.writableEnded) {
            ffmpegProcess.kill('SIGKILL');
            return;
        }
        res.write(`--${BOUNDARY}\r\n`);
        res.write(`Content-Type: image/jpeg\r\n`);
        res.write(`Content-Length: ${data.length}\r\n\r\n`);
        res.write(data);
        res.write(`\r\n`);
    });

    ffmpegProcess.stderr.on('data', (data) => {
        console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        if (!res.writableEnded) {
            res.end();
        }
    });

    ffmpegProcess.on('error', (err) => {
        console.error('Failed to start FFmpeg process:', err);
        if (!res.writableEnded) {
            res.status(500).send('Failed to start webcam stream. Is FFmpeg installed and configured correctly?').end();
        }
        ffmpegProcess.kill('SIGKILL');
    });

    req.on('close', () => {
        console.log(`Client disconnected from raw stream, killing FFmpeg process.`);
        ffmpegProcess.kill('SIGKILL');
    });
});


// --- Start Server ---
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
    console.log(`Access home page: http://localhost:${port} (will redirect to login)`);
    console.log(`Login API: POST http://localhost:${port}/login`);
    console.log(`Protected stream page: http://localhost:${port}/stream-page`);
    console.log(`Raw MJPEG stream data: http://localhost:${port}/stream (requires Authorization header)`);
});