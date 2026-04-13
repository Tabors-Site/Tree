const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

const SWIPE_RIGHT = 1;
const SWIPE_LEFT = 2;

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            return data;
        }
    } catch (e) {
        console.error('Error reading data file:', e);
    }
    return {
        swipes: [],
        matches: [],
        messages: []
    };
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateMockUsers() {
    const namesFirst = ['Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'James', 'Sophia', 'Benjamin', 'Isabella', 'Lucas'];
    const namesLast = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Garcia', 'Martinez', 'Anderson'];
    
    const users = [];
    for (let i = 0; i < 50; i++) {
        users.push({
            id: i + 1,
            name: `${namesFirst[i % namesFirst.length]} ${namesLast[i % namesLast.length]}`,
            age: 22 + Math.floor(Math.random() * 10),
            distance: 0 + Math.floor(Math.random() * 30),
            photo: `https://pravatar.cc/400?u=${i + 1}`,
            bio: getRandomBio()
        });
    }
    return users;
}

function getRandomBio() {
    const bios = [
        "Adventure seeker 🏔️",
        "Coffee addict ☕",
        "Dog lover 🐕",
        "Music is life 🎵",
        "Travel enthusiast ✈️",
        "Foodie 🍕",
        "Movie buff 🎬",
        "Always laughing 😂",
        "Beach vibes 🏖️",
        "Simplicity is key ✨"
    ];
    return bios[Math.floor(Math.random() * bios.length)];
}

function simulateMutualAttraction() {
    return Math.random() < 0.3;
}

function hasSwipe(data, userId, targetId) {
    return data.swipes.some(
        s => s.userId === userId && s.targetId === targetId
    );
}

function addSwipe(data, userId, targetId, direction, targetProfile) {
    if (hasSwipe(data, userId, targetId)) {
        return { userHasSwiped: true, matched: true, otherInfo: null };
    }

    const timestamp = Date.now();
    data.swipes.push({ userId, targetId, direction, timestamp });
    saveData(data);

    if (direction === SWIPE_LEFT) {
        return { userHasSwiped: false, matched: false, otherInfo: null };
    }

    const matched = simulateMutualAttraction();
    if (matched) {
        data.matches.push({
            userId,
            matchId: targetId,
            targetProfile: targetProfile,
            timestamp
        });
        saveData(data);
        return { userHasSwiped: false, matched: true, otherInfo: targetProfile };
    }

    return { userHasSwiped: false, matched: false, otherInfo: null };
}

function getMatches(data, userId) {
    return data.matches
        .filter(m => m.userId === userId)
        .map(m => ({
            name: m.targetProfile.name,
            age: m.targetProfile.age,
            photo: m.targetProfile.photo,
            timestamp: m.timestamp,
            matchId: m.matchId
        }));
}

function getSwipedUsers(data, userId) {
    return data.swipes
        .filter(s => s.userId === userId && s.direction === SWIPE_RIGHT)
        .map(s => s.targetId);
}

function getMessages(data, userId, matchId) {
    return data.messages
        .filter(m => (m.userId === userId && m.toUserId === matchId) || (m.userId === matchId && m.toUserId === userId))
        .sort((a, b) => a.timestamp - b.timestamp);
}

function sendMessage(data, userId, toUserId, message) {
    const msg = {
        id: Date.now(),
        userId,
        toUserId,
        message,
        timestamp: Date.now()
    };
    data.messages.push(msg);
    saveData(data);
    return msg;
}

const requestHandler = (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    if (url.pathname.startsWith('/public/')) {
        const filePath = path.join(__dirname, 'public', url.pathname.substring(1));
        const extname = path.extname(filePath);
        const contentTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.jpg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml'
        };
        
        const contentType = contentTypes[extname] || 'application/octet-stream';
        
        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('File not found');
                } else {
                    res.writeHead(500);
                    res.end('Server error');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            }
        });
    } else if (url.pathname === '/' || url.pathname === '') {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
    } else if (url.pathname === '/api/profiles') {
        const data = loadData();
        const userId = 1;
        const swipedUsers = getSwipedUsers(data, userId);
        const allUsers = generateMockUsers();
        const remainingUsers = allUsers.filter(u => !swipedUsers.includes(u.id));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(remainingUsers));
    } else if (url.pathname === '/api/swipe') {
        const data = loadData();
        const userId = 1;
        
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { userId: targetId, direction } = JSON.parse(body);
                const allUsers = generateMockUsers();
                const targetProfile = allUsers.find(u => u.id === targetId);
                
                const result = addSwipe(data, userId, targetId, direction, targetProfile);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
    } else if (url.pathname === '/api/matches') {
        const data = loadData();
        const userId = 1;
        const matches = getMatches(data, userId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(matches));
    } else if (url.pathname === '/api/stats') {
        const data = loadData();
        const userId = 1;
        const totalSwipedRight = data.swipes.filter(s => s.userId === userId && s.direction === SWIPE_RIGHT).length;
        const totalMatches = data.matches.filter(m => m.userId === userId).length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            swipedRight: totalSwipedRight,
            matches: totalMatches
        }));
    } else if (url.pathname === '/api/messages') {
        const urlParams = new URLSearchParams(url.search);
        const matchId = parseInt(urlParams.get('matchId'));
        
        if (!matchId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'matchId required' }));
            return;
        }
        
        const data = loadData();
        const userId = 1;
        const messages = getMessages(data, userId, matchId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(messages));
    } else if (url.pathname === '/api/send-message') {
        const data = loadData();
        const userId = 1;
        
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const { matchId, message } = JSON.parse(body);
                
                if (!matchId || !message) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'matchId and message required' }));
                    return;
                }
                
                const msg = sendMessage(data, userId, matchId, message);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(msg));
            } catch (err) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request data' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
};

const server = http.createServer(requestHandler);
server.listen(PORT, () => {
    console.log(`Tiner running on http://localhost:${PORT}`);
});
