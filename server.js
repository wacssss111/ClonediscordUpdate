
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');

const { initializeDatabase, userDB, messageDB, dmDB, groupDB, fileDB, reactionDB, friendDB, serverDB, db } = require('./database'); // Added db export

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3002; // Changed default port to 3002
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// In-memory store for connected users' sockets and their user IDs
const users = new Map(); // socket.id -> { id, username, avatar, socket }

// Map to store active calls and their start times for system messages
const activeCalls = new Map(); // key: dm_user_id (for DM), group_id (for group), or channel_id (for server voice) -> { startTime, type, participants: Map<socketId, {id, username, avatar}> }

// Bot user info (must match script.js)
const BOT_ID = -1; // Unique ID for the bot
const BOT_USERNAME = 'Bot2'; // Bot's username
const BOT_AVATAR_INITIAL = 'B'; // Bot's default avatar initial

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Allow all common file types (improved file type checking)
        const allowedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'audio/mpeg', 'audio/mp3', 'video/mp4', 'video/webm', 'video/quicktime',
            'application/zip', 'application/x-rar-compressed'
        ];
        
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf', '.doc', '.docx',
                                   '.txt', '.mp3', '.mp4', '.webm', '.mov', '.zip', '.rar'];
        
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            // For now, allow all files to prevent blocking, but log a warning.
            console.warn(`File type not explicitly allowed but accepted: ${file.mimetype}, extension: ${ext}`);
            cb(null, true); 
        }
    }
});

// Initialize database
initializeDatabase();

// JWT middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Доступ запрещен. Требуется токен авторизации.' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный токен.' });
        }
        req.user = user;
        next();
    });
}

// API Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
        }
        
        const existingUser = await userDB.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email уже зарегистрирован' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await userDB.create(username, email, hashedPassword);
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: username.charAt(0).toUpperCase() // Default avatar initial
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Регистрация не удалась' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны' });
        }
        
        const user = await userDB.findByEmail(email);
        if (!user) {
            return res.status(400).json({ error: 'Неверные учетные данные' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Неверные учетные данные' });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar // Return actual avatar now
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Вход не удался' });
    }
});

// Get user profile
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = await userDB.findById(req.user.id);
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить профиль' });
    }
});

// Update user profile (username)
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const { username } = req.body;
        if (!username || username.trim().length < 3) {
            return res.status(400).json({ error: 'Имя пользователя должно быть не менее 3 символов' });
        }

        // Check if username is already taken by another user
        const existingUserWithUsername = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.user.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (existingUserWithUsername) {
            return res.status(400).json({ error: 'Это имя пользователя уже занято' });
        }

        const currentUserData = await userDB.findById(req.user.id);
        // If avatar is not an upload URL, update it to the new initial
        let newAvatar = currentUserData.avatar;
        if (!newAvatar || !newAvatar.startsWith('/uploads/')) {
            newAvatar = username.charAt(0).toUpperCase();
        }
        
        await userDB.updateProfile(req.user.id, username, newAvatar);
        res.sendStatus(200);
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Не удалось обновить профиль' });
    }
});

// Update user avatar
app.post('/api/user/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл аватара не загружен' });
        }
        const avatarUrl = `/uploads/${req.file.filename}`;
        await userDB.updateAvatar(req.user.id, avatarUrl);
        res.json({ avatarUrl });
    } catch (error) {
        console.error('Upload avatar error:', error);
        res.status(500).json({ error: 'Не удалось загрузить аватар' });
    }
});

// Get all users
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const users = await userDB.getAll();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить пользователей' });
    }
});

// File upload for messages (channels, DMs, groups)
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }
        
        const { channelId, dmReceiverId, groupId } = req.body;

        let savedFileRecord;

        if (dmReceiverId) {
            savedFileRecord = await fileDB.create(
                req.file.filename,
                req.file.path,
                req.file.mimetype,
                req.file.size,
                req.user.id,
                null, // channelId
                null, // groupId
                dmReceiverId // dmReceiverId
            );
        } else if (groupId) {
            savedFileRecord = await fileDB.create(
                req.file.filename,
                req.file.path,
                req.file.mimetype,
                req.file.size,
                req.user.id,
                null, // channelId
                groupId, // groupId
                null // dmReceiverId
            );
        } else if (channelId) {
            savedFileRecord = await fileDB.create(
                req.file.filename,
                req.file.path,
                req.file.mimetype,
                req.file.size,
                req.user.id,
                channelId, // channelId
                null, // groupId
                null // dmReceiverId
            );
        } else {
            return res.status(400).json({ error: 'Не удалось определить, куда загружать файл.' });
        }
        
        res.json({
            id: savedFileRecord.id,
            filename: req.file.originalname,
            url: `/uploads/${req.file.filename}`,
            type: req.file.mimetype,
            size: req.file.size
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Загрузка не удалась' });
    }
});

// Get messages by channel
app.get('/api/messages/:channelId', authenticateToken, async (req, res) => {
    try {
        const messages = await messageDB.getByChannel(req.params.channelId);
        res.json(messages);
    }
    catch (error) {
        res.status(500).json({ error: 'Не удалось получить сообщения' });
    }
});

// Get direct messages
app.get('/api/dm/:userId', authenticateToken, async (req, res) => {
    try {
        // Special handling for Bot2, as its messages are not persisted in DB currently
        if (parseInt(req.params.userId) === BOT_ID) { 
            return res.json([]); 
        }
        const messages = await dmDB.getConversation(req.user.id, req.params.userId);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить сообщения' });
    }
});

// GROUP ROUTES
app.post('/api/groups', authenticateToken, async (req, res) => {
    try {
        const { name, members } = req.body; // members is array of userIds
        if (!name) return res.status(400).json({error: 'Имя обязательно'});

        // Check group limit
        const userGroupCount = await groupDB.getGroupCountByOwner(req.user.id);
        if (userGroupCount >= 10) { // Max 10 groups per user
            return res.status(400).json({ error: `Вы не можете создать более ${10} групп.` });
        }

        const group = await groupDB.create(name, req.user.id);
        
        // Add creator
        await groupDB.addMember(group.id, req.user.id);

        // Add members
        if (members && Array.isArray(members)) {
            for (const memberId of members) {
                await groupDB.addMember(group.id, memberId);
            }
        }

        res.json(group);
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ error: 'Не удалось создать группу' });
    }
});

// Get group count by owner
app.get('/api/groups/count', authenticateToken, async (req, res) => {
    try {
        const count = await groupDB.getGroupCountByOwner(req.user.id);
        res.json({ count });
    } catch (error) {
        console.error('Error getting group count:', error);
        res.status(500).json({ error: 'Не удалось получить количество групп' });
    }
});

app.put('/api/groups/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, icon } = req.body;
        
        const group = await groupDB.getGroup(groupId);
        if (!group || group.owner_id !== req.user.id) {
            return res.status(43).json({ error: 'Доступ запрещен' });
        }

        await groupDB.update(groupId, name, icon);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error updating group:', error);
        res.status(500).json({ error: 'Не удалось обновить группу' });
    }
});

app.delete('/api/groups/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        
        const group = await groupDB.getGroup(groupId);
        if (!group || group.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }

        await groupDB.delete(groupId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error deleting group:', error);
        res.status(500).json({ error: 'Не удалось удалить группу' });
    }
});

app.get('/api/groups', authenticateToken, async (req, res) => {
    try {
        const groups = await groupDB.getUserGroups(req.user.id);
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить группы' });
    }
});

app.get('/api/groups/:groupId/members', authenticateToken, async (req, res) => {
    try {
        const members = await groupDB.getMembers(req.params.groupId);
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить участников группы' });
    }
});

app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
    try {
        const messages = await groupDB.getMessages(req.params.groupId);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить сообщения группы' });
    }
});


// Friend routes
app.post('/api/friends/request', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        if (!friendId) {
            return res.status(400).json({ error: 'ID друга обязателен.' });
        }
        if (parseInt(friendId) === req.user.id) {
             return res.status(400).json({ error: 'Вы не можете отправить запрос в друзья самому себе.' });
        }

        const existingFriendship = await new Promise((resolve, reject) => {
            db.get('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?', [req.user.id, friendId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingFriendship) {
            if (existingFriendship.status === 'pending') {
                return res.status(400).json({ error: 'Запрос в друзья уже отправлен.' });
            } else if (existingFriendship.status === 'accepted') {
                return res.status(400).json({ error: 'Вы уже друзья с этим пользователем.' });
            }
        }
        
        // Check if there's a pending request from the other user
        const reverseRequest = await new Promise((resolve, reject) => {
            db.get('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?', [friendId, req.user.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (reverseRequest && reverseRequest.status === 'pending') {
            return res.status(400).json({ error: 'Этот пользователь уже отправил вам запрос в друзья. Примите его во вкладке "Ожидают".' });
        }

        const result = await friendDB.sendRequest(req.user.id, friendId);
        if (result.changes > 0) {
            // Notify the friend about the new request
            const friendSocket = Array.from(users.values()).find(u => u.id === parseInt(friendId));
            if (friendSocket) {
                io.to(friendSocket.socket.id).emit('new-friend-request');
            }
            res.status(200).json({ message: 'Запрос в друзья отправлен.' });
        } else {
            res.status(400).json({ error: 'Пользователь не найден или уже является другом' });
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        res.status(500).json({ error: 'Не удалось отправить запрос в друзья' });
    }
});

app.post('/api/friends/accept', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.acceptRequest(req.user.id, friendId);
        // Notify both users that they are now friends
        const friendSocket = Array.from(users.values()).find(u => u.id === parseInt(friendId));
        if (friendSocket) {
            io.to(friendSocket.socket.id).emit('friend-accepted', { userId: req.user.id });
        }
        res.sendStatus(200);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось принять запрос' });
    }
});

app.post('/api/friends/reject', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.rejectRequest(req.user.id, friendId);
        res.sendStatus(200);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось отклонить запрос' });
    }
});

app.delete('/api/friends/:friendId', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.params;
        await friendDB.removeFriend(req.user.id, friendId);
        res.sendStatus(200);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось удалить друга' });
    }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
    try {
        const friends = await friendDB.getFriends(req.user.id);
        res.json(friends);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить друзей' });
    }
});

app.get('/api/friends/pending', authenticateToken, async (req, res) => {
    try {
        const requests = await friendDB.getPendingRequests(req.user.id);
        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить запросы' });
    }
});

// Server routes (basic)
app.post('/api/servers', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        const server = await serverDB.create(name, req.user.id);
        await serverDB.addMember(server.id, req.user.id); // Add owner as member
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось создать сервер' });
    }
});

app.get('/api/servers', authenticateToken, async (req, res) => {
    try {
        const userServers = await serverDB.getUserServers(req.user.id);
        res.json(userServers);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить серверы' });
    }
});


// Socket.IO Logic
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return next(new Error('Authentication error'));
            }
            socket.user = user;
            next();
        });
    } else {
        next(new Error('Authentication error'));
    }
}).on('connection', (socket) => {
    console.log('User connected:', socket.user.username, `(${socket.user.id})`);
    
    // Store user socket
    users.set(socket.id, { id: socket.user.id, username: socket.user.username, avatar: socket.user.avatar, socket: socket });

    // Update user status to online
    userDB.updateStatus(socket.user.id, 'Online');
    
    // Notify all clients about updated user list
    io.emit('user-list-update', Array.from(users.values()).map(u => ({ id: u.id, username: u.username, status: 'Online' })));


    socket.on('send-message', async (data) => {
        const { channelId, message } = data;
        if (!channelId || !message || !message.text) return;

        try {
            const savedMessage = await messageDB.create(message.text, socket.user.id, channelId);
            
            // If file is included, update its channel_id
            if (message.file && message.file.id) { // Assuming file.id is passed if file was uploaded prior
                // This part needs to be integrated. Current upload only creates file record.
                // A better flow: client uploads, gets file URL, then sends message with file URL.
                // For now, if message contains file, assume it's already in DB.
            }

            io.emit('new-message', {
                channelId: channelId,
                message: {
                    id: savedMessage.id,
                    author: socket.user.username,
                    avatar: socket.user.avatar,
                    text: savedMessage.content,
                    timestamp: savedMessage.created_at,
                    file: message.file // Pass file info with message
                }
            });
        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    socket.on('send-dm', async (data) => {
        const { receiverId, message } = data;
        if (!receiverId || !message || !message.text) return;
        
        try {
            let savedMessage;

            // Handle bot messages where senderId is BOT_ID
            if (data.senderId === BOT_ID) {
                // If bot is sending, receiverId is the current user.
                // We don't save bot messages to DB for now.
                savedMessage = {
                    id: `bot-msg-${Date.now()}`,
                    content: message.text,
                    sender_id: BOT_ID,
                    receiver_id: receiverId,
                    created_at: message.timestamp
                };
            } else {
                // Regular DM
                savedMessage = await dmDB.create(message.text, socket.user.id, receiverId);
                // Attach file if present
                if (message.file && message.file.id) {
                    // Update file record to link to this DM
                }
            }

            const receiverSocket = Array.from(users.values()).find(u => u.id === parseInt(receiverId));
            const senderSocket = Array.from(users.values()).find(u => u.id === socket.user.id);
            
            // Send to receiver
            if (receiverSocket) {
                io.to(receiverSocket.socket.id).emit('new-dm', {
                    senderId: savedMessage.sender_id,
                    receiverId: savedMessage.receiver_id,
                    message: {
                        id: savedMessage.id,
                        author: data.senderId === BOT_ID ? BOT_USERNAME : socket.user.username,
                        avatar: data.senderId === BOT_ID ? BOT_AVATAR_INITIAL : socket.user.avatar,
                        text: savedMessage.content,
                        timestamp: savedMessage.created_at,
                        file: message.file
                    }
                });
            }
            // Confirm to sender that message was sent
            if (senderSocket) {
                io.to(senderSocket.socket.id).emit('dm-sent', {
                    receiverId: receiverId,
                    message: {
                        id: savedMessage.id,
                        author: socket.user.username,
                        avatar: socket.user.avatar,
                        text: savedMessage.content,
                        timestamp: savedMessage.created_at,
                        file: message.file
                    }
                });
            }

        } catch (error) {
            console.error('Error saving DM:', error);
        }
    });

    socket.on('send-group-message', async (data) => {
        const { groupId, message } = data;
        if (!groupId || !message || !message.text) return;

        try {
            const savedMessage = await groupDB.createMessage(message.text, groupId, socket.user.id);
            // Attach file if present
            if (message.file && message.file.id) {
                // Update file record to link to this group message
            }

            // Get all members of the group
            const groupMembers = await groupDB.getMembers(groupId);
            
            groupMembers.forEach(member => {
                const memberSocket = Array.from(users.values()).find(u => u.id === member.id);
                if (memberSocket) {
                    io.to(memberSocket.socket.id).emit('new-group-message', {
                        groupId: groupId,
                        message: {
                            id: savedMessage.id,
                            author: socket.user.username,
                            avatar: socket.user.avatar,
                            text: savedMessage.content,
                            timestamp: savedMessage.created_at,
                            file: message.file
                        }
                    });
                }
            });

        } catch (error) {
            console.error('Error saving group message:', error);
        }
    });

    socket.on('add-reaction', async (data) => {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;
        try {
            await reactionDB.add(emoji, messageId, socket.user.id);
            const reactions = await reactionDB.getByMessage(messageId);
            io.emit('reaction-update', { messageId, reactions }); // Emit to all clients
        } catch (error) {
            console.error('Error adding reaction:', error);
        }
    });

    socket.on('remove-reaction', async (data) => {
        const { messageId, emoji } = data;
        if (!messageId || !emoji) return;
        try {
            await reactionDB.remove(emoji, messageId, socket.user.id);
            const reactions = await reactionDB.getByMessage(messageId);
            io.emit('reaction-update', { messageId, reactions }); // Emit to all clients
        } catch (error) {
            console.error('Error removing reaction:', error);
        }
    });
    
    // === Voice/Video Call Logic ===
    socket.on('join-voice-channel', async (data) => {
        const { channelName, userId, username, avatar, startTime } = data;
        socket.join(channelName);
        console.log(`${username} joined voice channel: ${channelName}`);

        // Store active call details if not already present
        if (!activeCalls.has(channelName)) {
            activeCalls.set(channelName, { startTime: startTime, type: 'server-voice', participants: new Map() });
            
            // Emit system message to the text channel if it's a new call
            const channelId = getChannelIdByName(channelName);
            if (channelId) {
                const formattedStartTime = new Date(startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                io.emit('call-start-message', {
                    targetType: 'server-voice',
                    targetId: channelId,
                    initiatorId: userId,
                    message: `Голосовой звонок начался в ${formattedStartTime}`,
                    timestamp: startTime
                });
            }
        }
        activeCalls.get(channelName).participants.set(socket.id, { id: userId, username, avatar });

        // Notify others in the channel
        socket.to(channelName).emit('user-joined-voice', { socketId: socket.id, userId, username, avatar });

        // Send existing users to the newly joined user
        const existingUsers = Array.from(users.values())
                                .filter(u => socket.rooms.has(channelName) && u.id !== userId)
                                .map(u => ({ socketId: u.socket.id, id: u.id, username: u.username, avatar: u.avatar }));
        socket.emit('existing-voice-users', existingUsers);

        // Update own user status if needed (e.g., "In Call")
        userDB.updateStatus(userId, 'In Call');
    });

    socket.on('leave-voice-channel', async (channelName) => {
        socket.leave(channelName);
        console.log(`${socket.user.username} left voice channel: ${channelName}`);
        
        // Remove from active call participants
        if (activeCalls.has(channelName)) {
            activeCalls.get(channelName).participants.delete(socket.id);
            
            // If no more participants, end the call and emit system message
            if (activeCalls.get(channelName).participants.size === 0) {
                const callDetails = activeCalls.get(channelName);
                const endTime = new Date().toISOString();
                const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
                const durationMinutes = Math.floor(durationMs / 60000);
                const durationSeconds = Math.floor((durationMs % 60000) / 1000);
                
                const channelId = getChannelIdByName(channelName);
                if (channelId) {
                    io.emit('call-end-message', {
                        targetType: 'server-voice',
                        targetId: channelId,
                        initiatorId: socket.user.id,
                        message: `Голосовой звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                        timestamp: endTime
                    });
                }
                activeCalls.delete(channelName); // Remove call from active list
            }
        }
        
        socket.to(channelName).emit('user-left-voice', socket.id);
        // Update user status back to online (if not in other calls)
        userDB.updateStatus(socket.user.id, 'Online');
    });

    socket.on('initiate-call', async (data) => {
        const { to, from, type, startTime } = data; // `from` includes caller's userId, username, socketId, avatar
        const targetUserSocket = Array.from(users.values()).find(u => u.id === parseInt(to));
        
        if (targetUserSocket) {
            io.to(targetUserSocket.socket.id).emit('incoming-call', { from: from, type: type });
            console.log(`Call initiated from ${from.username} to ${targetUserSocket.username}`);

            // Store active DM call details
            if (!activeCalls.has(`dm-${from.id}-${to}`)) { // Key could be sorted pair for uniqueness
                 const dmKey = `${Math.min(from.id, to)}-${Math.max(from.id, to)}`;
                 activeCalls.set(dmKey, { startTime: startTime, type: 'dm', initiatorId: from.id, participants: new Map() });
                 activeCalls.get(dmKey).participants.set(from.socketId, { id: from.id, username: from.username, avatar: from.avatar });
                 
                 // Emit system message to the DM chat
                 const formattedStartTime = new Date(startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                 io.to(from.socketId).emit('call-start-message', {
                     targetType: 'dm',
                     targetId: to, // Receiver's ID for sender
                     initiatorId: from.id,
                     message: `Звонок начался в ${formattedStartTime}`,
                     timestamp: startTime
                 });
                 io.to(targetUserSocket.socket.id).emit('call-start-message', {
                     targetType: 'dm',
                     targetId: from.id, // Sender's ID for receiver
                     initiatorId: from.id,
                     message: `Звонок начался в ${formattedStartTime}`,
                     timestamp: startTime
                 });
            }
        } else {
            console.log(`User ${to} not found for call`);
            io.to(socket.id).emit('call-rejected', { message: 'Пользователь не в сети или не найден.' });
        }
    });

    socket.on('accept-call', (data) => {
        const { to, from, startTime } = data; // `from` is now the acceptor
        const initiatorSocket = Array.from(users.values()).find(u => u.socket.id === to);
        const acceptorSocket = Array.from(users.values()).find(u => u.socket.id === from.socketId);
        
        if (initiatorSocket && acceptorSocket) {
            io.to(initiatorSocket.socket.id).emit('call-accepted', { from: from });
            io.to(acceptorSocket.socket.id).emit('call-accepted', { from: initiatorSocket.user }); // Send initiator's info back
            console.log(`Call accepted by ${from.username}`);

            // Update active DM call details
            const dmKey = `${Math.min(initiatorSocket.user.id, from.id)}-${Math.max(initiatorSocket.user.id, from.id)}`;
            if (activeCalls.has(dmKey)) {
                activeCalls.get(dmKey).participants.set(from.socketId, { id: from.id, username: from.username, avatar: from.avatar });
            }
        }
    });

    socket.on('reject-call', (data) => {
        const { to, message } = data;
        const initiatorSocket = Array.from(users.values()).find(u => u.socket.id === to);
        if (initiatorSocket) {
            io.to(initiatorSocket.socket.id).emit('call-rejected', { message: message });
            console.log(`Call rejected by ${socket.user.username}`);
        }

        // Clean up activeCalls for DM if the call was rejected
        const dmKey1 = `${Math.min(socket.user.id, initiatorSocket.user.id)}-${Math.max(socket.user.id, initiatorSocket.user.id)}`;
        const dmKey2 = `${Math.min(initiatorSocket.user.id, socket.user.id)}-${Math.max(initiatorSocket.user.id, socket.user.id)}`;

        const callDetails = activeCalls.get(dmKey1) || activeCalls.get(dmKey2);
        if (callDetails) {
            const endTime = new Date().toISOString();
            const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);

            // Emit call-end-message to both participants
            io.to(socket.id).emit('call-end-message', {
                targetType: 'dm',
                targetId: initiatorSocket.user.id,
                initiatorId: socket.user.id,
                message: `Звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                timestamp: endTime
            });
            io.to(initiatorSocket.socket.id).emit('call-end-message', {
                targetType: 'dm',
                targetId: socket.user.id,
                initiatorId: socket.user.id,
                message: `Звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                timestamp: endTime
            });
            activeCalls.delete(dmKey1);
            activeCalls.delete(dmKey2);
        }
    });

    socket.on('end-call', (data) => {
        const { to } = data; // ID of the other participant in the DM
        const targetUserSocket = Array.from(users.values()).find(u => u.id === parseInt(to));

        if (targetUserSocket) {
            io.to(targetUserSocket.socket.id).emit('call-ended', { from: socket.id });
            console.log(`Call ended by ${socket.user.username}`);
        }
        // Clean up activeCalls for DM
        const dmKey = `${Math.min(socket.user.id, to)}-${Math.max(socket.user.id, to)}`;
        const callDetails = activeCalls.get(dmKey);
        if (callDetails) {
            const endTime = new Date().toISOString();
            const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);

            // Emit call-end-message to both participants
            io.to(socket.id).emit('call-end-message', {
                targetType: 'dm',
                targetId: to, // Receiver's ID for sender
                initiatorId: socket.user.id,
                message: `Звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                timestamp: endTime
            });
            if (targetUserSocket) {
                io.to(targetUserSocket.socket.id).emit('call-end-message', {
                    targetType: 'dm',
                    targetId: socket.user.id, // Sender's ID for receiver
                    initiatorId: socket.user.id,
                    message: `Звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                    timestamp: endTime
                });
            }
            activeCalls.delete(dmKey);
        }
    });

    socket.on('initiate-group-call', async (data) => {
        const { groupId, callerInfo, type, startTime } = data;
        
        // Join the socket room for this group (caller joins)
        socket.join(`group-${groupId}`);
        console.log(`${callerInfo.username} initiated group call in group ${groupId}`);

        // Store active group call details
        if (!activeCalls.has(`group-${groupId}`)) {
            activeCalls.set(`group-${groupId}`, { startTime: startTime, type: 'group', participants: new Map() });
            // Emit system message to the group chat
            const formattedStartTime = new Date(startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            // Get all group members and emit to them
            const groupMembers = await groupDB.getMembers(groupId);
            groupMembers.forEach(member => {
                const memberSocket = Array.from(users.values()).find(u => u.id === member.id);
                if (memberSocket) {
                    io.to(memberSocket.socket.id).emit('call-start-message', {
                        targetType: 'group',
                        targetId: groupId,
                        initiatorId: callerInfo.id,
                        message: `Групповой звонок начался в ${formattedStartTime}`,
                        timestamp: startTime
                    });
                }
            });
        }
        activeCalls.get(`group-${groupId}`).participants.set(socket.id, { id: callerInfo.id, username: callerInfo.username, avatar: callerInfo.avatar });

        // Notify ALL group members individually, because they might not be in the socket room yet
        const groupMembers = await groupDB.getMembers(groupId);
        groupMembers.forEach(member => {
            // Do not send notification to the caller
            if (member.id === callerInfo.id) return;

            const memberSocket = Array.from(users.values()).find(u => u.id === member.id);
            if (memberSocket) {
                io.to(memberSocket.socket.id).emit('incoming-group-call', { groupId: groupId, callerInfo: callerInfo, type: type });
            }
        });

        // Send existing voice users to the new caller
        const existingVoiceUsers = Array.from(activeCalls.get(`group-${groupId}`).participants.values())
            .filter(p => p.id !== callerInfo.id)
            .map(p => ({ socketId: Array.from(users.values()).find(u => u.id === p.id)?.socket.id, id: p.id, username: p.username, avatar: p.avatar })); // Map back to socketId

        if (existingVoiceUsers.length > 0) {
            socket.emit('existing-voice-users', existingUsers);
        }
    });

    socket.on('accept-group-call', async (data) => {
        const { groupId, from, startTime } = data;
        socket.join(`group-${groupId}`);
        console.log(`${from.username} accepted group call in group ${groupId}`);

        if (activeCalls.has(`group-${groupId}`)) {
            activeCalls.get(`group-${groupId}`).participants.set(socket.id, { id: from.id, username: from.username, avatar: from.avatar });
        }

        // Notify all other members in the group
        socket.to(`group-${groupId}`).emit('group-call-accepted', { groupId: groupId, from: from });

        // Send existing voice users to the new joiner
        const existingVoiceUsers = Array.from(activeCalls.get(`group-${groupId}`).participants.values())
            .filter(p => p.id !== from.id)
            .map(p => ({ socketId: Array.from(users.values()).find(u => u.id === p.id)?.socket.id, id: p.id, username: p.username, avatar: p.avatar }));
        
        if (existingVoiceUsers.length > 0) {
            socket.emit('existing-voice-users', existingVoiceUsers);
        }
    });

    socket.on('reject-group-call', async (data) => {
        const { groupId, to, from, message } = data; // `from` is the rejector
        // Notify the caller only
        const callerSocket = Array.from(users.values()).find(u => u.socket.id === to);
        if (callerSocket) {
            io.to(callerSocket.socket.id).emit('group-call-rejected', { groupId: groupId, message: message });
        }
        console.log(`${from.username} rejected group call in group ${groupId}`);

        // Clean up activeCalls for group if it was the last participant to reject/leave
        if (activeCalls.has(`group-${groupId}`)) {
            activeCalls.get(`group-${groupId}`).participants.delete(socket.id); // Remove rejector
            if (activeCalls.get(`group-${groupId}`).participants.size === 0) {
                const callDetails = activeCalls.get(`group-${groupId}`);
                const endTime = new Date().toISOString();
                const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
                const durationMinutes = Math.floor(durationMs / 60000);
                const durationSeconds = Math.floor((durationMs % 60000) / 1000);
                
                // Get all group members and emit to them
                groupDB.getMembers(groupId).then(groupMembers => {
                    groupMembers.forEach(member => {
                        const memberSocket = Array.from(users.values()).find(u => u.id === member.id);
                        if (memberSocket) {
                            io.to(memberSocket.socket.id).emit('call-end-message', {
                                targetType: 'group',
                                targetId: groupId,
                                initiatorId: from.id,
                                message: `Групповой звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                                timestamp: endTime
                            });
                        }
                    });
                }).catch(err => console.error('Error getting group members on disconnect:', err));
                activeCalls.delete(`group-${groupId}`); // Remove call from active list
            }
        }
    });

    socket.on('leave-group-voice', async (data) => {
        const { groupId } = data;
        socket.leave(`group-${groupId}`);
        console.log(`${socket.user.username} left group voice in group ${groupId}`);
        
        // Remove from active call participants
        if (activeCalls.has(`group-${groupId}`)) {
            activeCalls.get(`group-${groupId}`).participants.delete(socket.id);
            
            // If no more participants, end the call and emit system message
            if (activeCalls.get(`group-${groupId}`).participants.size === 0) {
                const callDetails = activeCalls.get(`group-${groupId}`);
                const endTime = new Date().toISOString();
                const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
                const durationMinutes = Math.floor(durationMs / 60000);
                const durationSeconds = Math.floor((durationMs % 60000) / 1000);

                // Get all group members and emit to them
                groupDB.getMembers(groupId).then(groupMembers => {
                    groupMembers.forEach(member => {
                        const memberSocket = Array.from(users.values()).find(u => u.id === member.id);
                        if (memberSocket) {
                            io.to(memberSocket.socket.id).emit('call-end-message', {
                                targetType: 'group',
                                targetId: groupId,
                                initiatorId: socket.user.id, // The one who left last
                                message: `Групповой звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                                timestamp: endTime
                            });
                        }
                    });
                }).catch(err => console.error('Error getting group members on disconnect:', err));
                activeCalls.delete(`group-${groupId}`); // Remove call from active list
            }
        }
        
        socket.to(`group-${groupId}`).emit('user-left-voice', socket.id);
        userDB.updateStatus(socket.user.id, 'Online');
    });

    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', { from: socket.id, offer: data.offer });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', { from: socket.id, answer: data.answer });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', { from: socket.id, candidate: data.candidate });
    });
    
    socket.on('video-toggle', (data) => {
        // Broadcast video toggle to others in the same voice channel or DM call
        if (window.currentCallDetails?.groupId) { // Group call
            socket.to(`group-${window.currentCallDetails.groupId}`).emit('video-toggle', { from: socket.id, enabled: data.enabled });
        } else if (window.currentCallDetails?.friendId) { // DM call
            const targetSocket = Array.from(users.values()).find(u => u.id === window.currentCallDetails.friendId);
            if (targetSocket) {
                io.to(targetSocket.socket.id).emit('video-toggle', { from: socket.id, enabled: data.enabled });
            }
        } else if (socket.rooms.size > 1) { // Assuming socket.rooms[0] is own socket.id
            const voiceChannelRoom = Array.from(socket.rooms).find(room => room !== socket.id);
            if (voiceChannelRoom) {
                socket.to(voiceChannelRoom).emit('video-toggle', { from: socket.id, enabled: data.enabled });
            }
        }
    });

    socket.on('voice-activity', (data) => {
        // Broadcast voice activity to others in the same voice channel or DM call
        if (window.currentCallDetails?.groupId) { // Group call
            socket.to(`group-${window.currentCallDetails.groupId}`).emit('user-speaking', { socketId: socket.id, speaking: data.speaking });
        } else if (window.currentCallDetails?.friendId) { // DM call
            const targetSocket = Array.from(users.values()).find(u => u.id === window.currentCallDetails.friendId);
            if (targetSocket) {
                io.to(targetSocket.socket.id).emit('user-speaking', { socketId: socket.id, speaking: data.speaking });
            }
        } else if (socket.rooms.size > 1) { // Assuming socket.rooms[0] is own socket.id
            const voiceChannelRoom = Array.from(socket.rooms).find(room => room !== socket.id);
            if (voiceChannelRoom) {
                socket.to(voiceChannelRoom).emit('user-speaking', { socketId: socket.id, speaking: data.speaking });
            }
        }
    });

    socket.on('ping', (clientSendTime) => { // Server receives client's timestamp
        socket.emit('pong', clientSendTime); // Server immediately echoes it back
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.user.username);
        
        // Remove user from the map
        users.delete(socket.id);

        // Update user status to offline
        userDB.updateStatus(socket.user.id, 'Offline');
        
        // Notify all clients about updated user list
        io.emit('user-list-update', Array.from(users.values()).map(u => ({ id: u.id, username: u.username, status: 'Online' })));
        
        // If user was in a voice channel, leave it
        for (const room of socket.rooms) {
            if (room.startsWith('group-')) {
                const groupId = parseInt(room.substring(6));
                // Clean up activeCalls for group
                if (activeCalls.has(room)) {
                    activeCalls.get(room).participants.delete(socket.id);
                    if (activeCalls.get(room).participants.size === 0) {
                        const callDetails = activeCalls.get(room);
                        const endTime = new Date().toISOString();
                        const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
                        const durationMinutes = Math.floor(durationMs / 60000);
                        const durationSeconds = Math.floor((durationMs % 60000) / 1000);
                        
                        // Get all group members and emit to them
                        groupDB.getMembers(groupId).then(groupMembers => {
                            groupMembers.forEach(member => {
                                const memberSocket = Array.from(users.values()).find(u => u.id === member.id);
                                if (memberSocket) {
                                    io.to(memberSocket.socket.id).emit('call-end-message', {
                                        targetType: 'group',
                                        targetId: groupId,
                                        initiatorId: socket.user.id,
                                        message: `Групповой звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                                        timestamp: endTime
                                    });
                                }
                            });
                        }).catch(err => console.error('Error getting group members on disconnect:', err));
                        activeCalls.delete(room);
                    }
                }
                io.to(room).emit('user-left-voice', socket.id);
            } else if (room !== socket.id) { // It's a server voice channel
                // Clean up activeCalls for server voice channel
                if (activeCalls.has(room)) {
                    activeCalls.get(room).participants.delete(socket.id);
                    if (activeCalls.get(room).participants.size === 0) {
                        const callDetails = activeCalls.get(room);
                        const endTime = new Date().toISOString();
                        const durationMs = new Date(endTime).getTime() - new Date(callDetails.startTime).getTime();
                        const durationMinutes = Math.floor(durationMs / 60000);
                        const durationSeconds = Math.floor((durationMs % 60000) / 1000);
                        
                        // Emit to all users for a server channel
                        const channelId = getChannelIdByName(room);
                        if (channelId) {
                            io.emit('call-end-message', {
                                targetType: 'server-voice',
                                targetId: channelId,
                                initiatorId: socket.user.id,
                                message: `Голосовой звонок завершился. Длительность: ${durationMinutes} минут ${durationSeconds} секунд.`,
                                timestamp: endTime
                            });
                        }
                        activeCalls.delete(room);
                    }
                }
                io.to(room).emit('user-left-voice', socket.id);
            }
        }
        
        // Removed reference to client-side peerConnections variable.
        // Server side does not maintain peer connections in the same way.
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
