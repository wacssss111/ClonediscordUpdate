

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');

const { initializeDatabase, userDB, messageDB, dmDB, groupDB, fileDB, reactionDB, friendDB, serverDB } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001; // Changed default port to 3001
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
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
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить сообщения' });
    }
});

// Get direct messages
app.get('/api/dm/:userId', authenticateToken, async (req, res) => {
    try {
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
        console.error('Group create error:', error);
        res.status(500).json({error: 'Не удалось создать группу'});
    }
});

app.put('/api/groups/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, icon } = req.body;

        const group = await groupDB.getGroup(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        if (group.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'У вас нет прав для редактирования этой группы' });
        }

        await groupDB.update(groupId, name, icon);
        res.sendStatus(200);
    } catch (error) {
        console.error('Group update error:', error);
        res.status(500).json({ error: 'Не удалось обновить группу' });
    }
});

app.delete('/api/groups/:groupId', authenticateToken, async (req, res) => {
    try {
        const { groupId } = req.params;
        const group = await groupDB.getGroup(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        if (group.owner_id !== req.user.id) {
            return res.status(403).json({ error: 'У вас нет прав для удаления этой группы' });
        }

        await groupDB.delete(groupId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Group delete error:', error);
        res.status(500).json({ error: 'Не удалось удалить группу' });
    }
});


app.get('/api/groups', authenticateToken, async (req, res) => {
    try {
        const groups = await groupDB.getUserGroups(req.user.id);
        res.json(groups);
    } catch(error) {
        console.error('Get groups error', error);
        res.status(500).json({error: 'Не удалось получить группы'});
    }
});

app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
    try {
        const messages = await groupDB.getMessages(req.params.groupId);
        res.json(messages);
    } catch(error) {
        res.status(500).json({error: 'Не удалось получить сообщения группы'});
    }
});

app.get('/api/groups/:groupId/members', authenticateToken, async (req, res) => {
    try {
        const members = await groupDB.getMembers(req.params.groupId);
        res.json(members);
    } catch (error) {
        console.error('Error fetching group members:', error);
        res.status(500).json({ error: 'Не удалось получить участников группы' });
    }
});


// Server routes
app.post('/api/servers', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Имя сервера должно быть не менее 2 символов' });
        }
        
        const server = await serverDB.create(name.trim(), req.user.id);
        await serverDB.addMember(server.id, req.user.id);
        
        res.json(server);
    } catch (error) {
        console.error('Create server error:', error);
        res.status(500).json({ error: 'Не удалось создать сервер' });
    }
});

app.get('/api/servers', authenticateToken, async (req, res) => {
    try {
        const servers = await serverDB.getUserServers(req.user.id);
        res.json(servers);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить серверы' });
    }
});

app.get('/api/servers/:serverId/members', authenticateToken, async (req, res) => {
    try {
        const members = await serverDB.getMembers(req.params.serverId);
        res.json(members);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить участников сервера' });
    }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
    try {
        const friends = await friendDB.getFriends(req.user.id);
        res.json(friends);
    } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ error: 'Не удалось получить друзей' });
    }
});

app.get('/api/friends/pending', authenticateToken, async (req, res) => {
    try {
        const requests = await friendDB.getPendingRequests(req.user.id);
        res.json(requests);
    } catch (error) {
        console.error('Get pending requests error:', error);
        res.status(500).json({ error: 'Не удалось получить ожидающие запросы' });
    }
});

// Friend request routes
app.post('/api/friends/request', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;

        if (parseInt(friendId) === req.user.id) {
            return res.status(400).json({ error: 'Вы не можете отправить запрос в друзья самому себе.' });
        }

        // Check if already friends
        const isFriend = await friendDB.checkFriendship(req.user.id, friendId);
        if (isFriend) {
            return res.status(409).json({ error: 'Вы уже друзья.' });
        }

        // Check if request already sent by current user
        const existingSentRequest = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = "pending"', [req.user.id, friendId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (existingSentRequest) {
            return res.status(409).json({ error: 'Вы уже отправили запрос этому пользователю.' });
        }

        // Check for incoming request from the target user
        const existingIncomingRequest = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = "pending"', [friendId, req.user.id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (existingIncomingRequest) {
            return res.status(409).json({ error: 'Этот пользователь уже отправил вам запрос в друзья.' });
        }
        
        const result = await friendDB.sendRequest(req.user.id, friendId);

        if (result.changes > 0) {
            const receiverSocket = Array.from(users.values()).find(u => u.id === friendId);
            if (receiverSocket) {
                io.to(`user-${friendId}`).emit('new-friend-request');
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Friend request error:', error);
        res.status(500).json({ error: 'Не удалось отправить запрос в друзья' });
    }
});

app.post('/api/friends/accept', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.acceptRequest(req.user.id, friendId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Accept friend request error:', error);
        res.status(500).json({ error: 'Не удалось принять запрос в друзья' });
    }
});

app.post('/api/friends/reject', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.rejectRequest(req.user.id, friendId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Reject friend request error:', error);
        res.status(500).json({ error: 'Не удалось отклонить запрос в друзья' });
    }
});

app.delete('/api/friends/:friendId', authenticateToken, async (req, res) => {
    try {
        await friendDB.removeFriend(req.user.id, req.params.friendId);
        res.sendStatus(200);
    } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ error: 'Не удалось удалить друга' });
    }
});

// Store connected users
const users = new Map(); // socketId -> { id, username, email, avatar, status, socketId }
const rooms = new Map(); // roomName -> Set<socketId>

// Socket.IO connection handling
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.userId = decoded.id;
        socket.userEmail = decoded.email;
        next();
    });
});

io.on('connection', async (socket) => {
    console.log('User connected:', socket.userId);
    
    try {
        const user = await userDB.findById(socket.userId);
        
        users.set(socket.id, {
            ...user,
            socketId: socket.id
        });
        
        // Update user status
        await userDB.updateStatus(socket.userId, 'Online');
        
        // Join user to their own room for notifications
        socket.join(`user-${socket.userId}`);

        // Join all groups the user is a member of
        const userGroups = await groupDB.getUserGroups(socket.userId);
        userGroups.forEach(g => {
            socket.join(`group-${g.id}`);
        });
        
        io.emit('user-list-update', Array.from(users.values()));
    } catch (error) {
        console.error('Error loading user:', error);
    }

    // Handle ping for call quality
    socket.on('ping', () => {
        socket.emit('pong', Date.now() - socket.handshake.time);
    });

    // User sends message
    socket.on('send-message', async (messageData) => {
        try {
            const { channelId, message } = messageData;
            
            // Get user info
            const user = users.get(socket.id); // Get current user from map
            
            // Save to database
            const savedMessage = await messageDB.create(
                message.text,
                socket.userId,
                channelId
            );
            
            // Broadcast message with full user info
            const broadcastMessage = {
                id: savedMessage.id,
                author: user.username,
                avatar: user.avatar,
                text: message.text,
                timestamp: new Date(), // Client will format this
                file: message.file // Include file info if present
            };
            
            io.to(`channel-${channelId}`).emit('new-message', {
                channelId,
                message: broadcastMessage
            });
        } catch (error) {
            console.error('Message error:', error);
        }
    });

    // Group Message
    socket.on('send-group-message', async (data) => {
        try {
            const { groupId, message } = data;
            const sender = users.get(socket.id);

            const saved = await groupDB.createMessage(message.text, groupId, socket.userId);
            
            const payload = {
                id: saved.id,
                author: sender.username,
                avatar: sender.avatar,
                text: message.text,
                timestamp: new Date(),
                file: message.file // Include file info if present
            };

            io.to(`group-${groupId}`).emit('new-group-message', {
                groupId,
                message: payload
            });

        } catch (e) {
            console.error("Group message error", e);
        }
    });

    // Join Group Voice
    socket.on('join-group-voice', (data) => {
        const { groupId } = data;
        const roomName = `group-voice-${groupId}`;
        
        socket.join(roomName);
        if (!rooms.has(roomName)) rooms.set(roomName, new Set());
        rooms.get(roomName).add(socket.id);

        socket.to(roomName).emit('user-joined-voice', {
            socketId: socket.id,
            userId: socket.userId, // Pass userId for easier lookup
            username: users.get(socket.id)?.username || 'Unknown',
            avatar: users.get(socket.id)?.avatar || 'U'
        });

        // Send existing users in room
        const existingIds = Array.from(rooms.get(roomName)).filter(id => id !== socket.id);
        const existingUsers = existingIds.map(id => users.get(id) || {id: users.get(id)?.id, username: 'Unknown', avatar: 'U', socketId: id});
        socket.emit('existing-voice-users', existingUsers);
    });

    // Leave Group Voice
    socket.on('leave-group-voice', (data) => {
        const { groupId } = data;
        const roomName = `group-voice-${groupId}`;
        socket.leave(roomName);
        if (rooms.has(roomName)) {
            rooms.get(roomName).delete(socket.id);
            io.to(roomName).emit('user-left-voice', socket.id);
        }
    });

    // Initiate group call (notification to all group members)
    socket.on('initiate-group-call', async (data) => {
        const { groupId, callerInfo, type } = data;
        console.log(`Group call initiated by ${callerInfo.username} for group ${groupId}`);

        const members = await groupDB.getMembers(groupId); // Get all members from DB
        members.forEach(member => {
            // Don't send notification to the caller themselves
            if (member.id !== callerInfo.id) {
                io.to(`user-${member.id}`).emit('incoming-group-call', {
                    groupId,
                    callerInfo: {
                        id: callerInfo.id,
                        username: callerInfo.username,
                        socketId: callerInfo.socketId,
                        avatar: callerInfo.avatar
                    },
                    type: type
                });
            }
        });
        // Also have the caller join the group voice channel immediately
        socket.join(`group-voice-${groupId}`);
        if (!rooms.has(`group-voice-${groupId}`)) rooms.set(`group-voice-${groupId}`, new Set());
        rooms.get(`group-voice-${groupId}`).add(socket.id);
    });

    socket.on('accept-group-call', async (data) => {
        const { groupId, from } = data;
        console.log(`${from.username} accepted group call for group ${groupId}`);

        const roomName = `group-voice-${groupId}`;
        if (!rooms.has(roomName)) rooms.set(roomName, new Set());
        rooms.get(roomName).add(socket.id);
        socket.join(roomName);

        socket.to(roomName).emit('user-joined-voice', {
            socketId: socket.id,
            userId: socket.userId,
            username: from.username,
            avatar: from.avatar
        });
    });

    socket.on('reject-group-call', (data) => {
        const { groupId, to, from, message } = data;
        console.log(`${from.username} rejected group call for group ${groupId}, notifying ${to}`);
        // Notify the caller that the call was rejected
        io.to(to).emit('group-call-rejected', {
            from: from.socketId,
            message: message
        });
    });


    // Direct message
    socket.on('send-dm', async (data) => {
        try {
            const { receiverId, message } = data;
            const sender = users.get(socket.id);

            const savedMessage = await dmDB.create(
                message.text,
                socket.userId,
                receiverId
            );

            const messagePayload = {
                id: savedMessage.id,
                author: sender.username,
                avatar: sender.avatar,
                text: message.text,
                timestamp: new Date(),
                file: message.file // Include file info if present
            };

            // Send to receiver
            io.to(`user-${receiverId}`).emit('new-dm', {
                senderId: socket.userId,
                message: messagePayload
            });
            
            // Send back to sender
            socket.emit('dm-sent', {
                receiverId,
                message: messagePayload
            });
        } catch (error) {
            console.error('DM error:', error);
        }
    });

    // Add reaction
    socket.on('add-reaction', async (data) => {
        try {
            const { messageId, emoji } = data;
            await reactionDB.add(emoji, messageId, socket.userId);
            
            const reactions = await reactionDB.getByMessage(messageId);
            io.emit('reaction-update', { messageId, reactions });
        } catch (error) {
            console.error('Reaction error:', error);
        }
    });

    // Remove reaction
    socket.on('remove-reaction', async (data) => {
        try {
            const { messageId, emoji } = data;
            await reactionDB.remove(emoji, messageId, socket.userId);
            
            const reactions = await reactionDB.getByMessage(messageId);
            io.emit('reaction-update', { messageId, reactions });
        } catch (error) {
            console.error('Reaction error:', error);
        }
    });

    // Voice activity detection
    socket.on('voice-activity', (data) => {
        // Emit to all members in the same voice room
        let currentVoiceRoom = null;
        for (const [roomName, members] of rooms.entries()) {
            if (members.has(socket.id) && roomName.startsWith('voice-') || roomName.startsWith('group-voice-')) {
                currentVoiceRoom = roomName;
                break;
            }
        }
        if (currentVoiceRoom) {
            io.to(currentVoiceRoom).emit('user-speaking', {
                socketId: socket.id,
                speaking: data.speaking
            });
        }
    });

    // Join voice channel (for server channels)
    socket.on('join-voice-channel', (channelData) => {
        const { channelName, userId, username, avatar } = channelData;
        const roomName = `voice-${channelName}`;
        
        socket.join(roomName);
        
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Set());
        }
        rooms.get(roomName).add(socket.id);
        
        socket.to(roomName).emit('user-joined-voice', {
            userId,
            socketId: socket.id,
            username: username,
            avatar: avatar
        });
        
        const existingUsers = Array.from(rooms.get(roomName))
            .filter(id => id !== socket.id)
            .map(id => users.get(id));
        
        socket.emit('existing-voice-users', existingUsers);
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on('leave-voice-channel', (channelName) => {
        const roomName = `voice-${channelName}`;
        socket.leave(roomName);
        
        if (rooms.has(roomName)) {
            rooms.get(roomName).delete(socket.id);
            io.to(roomName).emit('user-left-voice', socket.id);
        }
    });

    // Handle call initiation (DM)
    socket.on('initiate-call', (data) => {
        const { to, type, from } = data;
        console.log(`Call initiated from ${from.username} to ${to}, type: ${type}`);
        
        // Find receiver socket
        const receiverSocketInfo = Array.from(users.values()).find(u => u.id === to);
        if (receiverSocketInfo) {
            // Send incoming call notification to receiver
            io.to(`user-${to}`).emit('incoming-call', {
                from: {
                    id: from.id,
                    username: from.username,
                    socketId: socket.id,
                    avatar: from.avatar
                },
                type: type
            });
        } else {
            // User is offline
            socket.emit('call-rejected', { message: 'Пользователь не в сети' });
        }
    });

    socket.on('accept-call', (data) => {
        const { to, from } = data;
        console.log(`Call accepted by ${from.username}, connecting to ${to}`);
        
        // Notify the caller that call was accepted
        io.to(to).emit('call-accepted', {
            from: {
                id: from.id,
                username: from.username,
                socketId: socket.id
            }
        });
        // Also connect the accepter to the caller for direct WebRTC signaling
        // Add accepter to a temporary DM voice room
        const dmRoomName = `dm-voice-${Math.min(from.id, to)}-${Math.max(from.id, to)}`;
        socket.join(dmRoomName);
        if (!rooms.has(dmRoomName)) rooms.set(dmRoomName, new Set());
        rooms.get(dmRoomName).add(socket.id);

        io.to(dmRoomName).emit('user-joined-voice', {
            socketId: socket.id,
            userId: from.id,
            username: from.username,
            avatar: from.avatar
        });
    });

    socket.on('reject-call', (data) => {
        const { to, message } = data;
        console.log(`Call rejected by ${socket.userId}, notifying ${to}`);
        
        // Notify the caller that call was rejected
        io.to(to).emit('call-rejected', {
            from: socket.id,
            message: message
        });
    });
    
    // Video toggle handler
    socket.on('video-toggle', (data) => {
        const { to, enabled } = data;
        if (to) {
            io.to(to).emit('video-toggle', {
                from: socket.id,
                enabled: enabled
            });
        }
    });
    
    // End call
    socket.on('end-call', (data) => {
        const { to } = data; // 'to' is the peer's socketId
        if (to) {
            io.to(to).emit('call-ended', { from: socket.id });
        }
        // Remove from any temporary DM voice room
        rooms.forEach((members, roomName) => {
            if (members.has(socket.id) && roomName.startsWith('dm-voice-')) {
                members.delete(socket.id);
                io.to(roomName).emit('user-left-voice', socket.id);
            }
        });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        const user = users.get(socket.id);
        
        if (user) {
            console.log(`${user.username} disconnected`);
            
            // Update status in database
            try {
                await userDB.updateStatus(socket.userId, 'Offline');
            } catch (error) {
                console.error('Error updating status:', error);
            }
            
            rooms.forEach((members, roomName) => {
                if (members.has(socket.id)) {
                    members.delete(socket.id);
                    // Differentiate between group/server voice and DM voice to emit to correct room
                    if (roomName.startsWith('voice-') || roomName.startsWith('group-voice-')) {
                        io.to(roomName).emit('user-left-voice', socket.id);
                    } else if (roomName.startsWith('dm-voice-')) {
                        io.to(roomName).emit('user-left-voice', socket.id);
                    }
                }
            });
            
            users.delete(socket.id);
            io.emit('user-list-update', Array.from(users.values()));
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Discord Clone server running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/login.html in your browser`);
});