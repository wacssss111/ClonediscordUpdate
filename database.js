

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'discord_clone.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                avatar TEXT,
                status TEXT DEFAULT 'Online',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Servers table
        db.run(`
            CREATE TABLE IF NOT EXISTS servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                icon TEXT,
                owner_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        `);

        // Channels table
        db.run(`
            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                server_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (server_id) REFERENCES servers(id)
            )
        `);

        // Messages table
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                user_id INTEGER,
                channel_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (channel_id) REFERENCES channels(id)
            )
        `);

        // Direct messages table
        db.run(`
            CREATE TABLE IF NOT EXISTS direct_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                sender_id INTEGER,
                receiver_id INTEGER,
                read BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users(id),
                FOREIGN KEY (receiver_id) REFERENCES users(id)
            )
        `);

        // GROUPS TABLES
        db.run(`
            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                icon TEXT, -- Added for group icons
                owner_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS group_members (
                group_id INTEGER,
                user_id INTEGER,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(group_id, user_id)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS group_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                group_id INTEGER,
                user_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES groups(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // File uploads table
        db.run(`
            CREATE TABLE IF NOT EXISTS file_uploads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                filetype TEXT,
                filesize INTEGER,
                user_id INTEGER,
                channel_id INTEGER,
                group_id INTEGER, -- Added for group file uploads
                dm_receiver_id INTEGER, -- Added for DM file uploads
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (channel_id) REFERENCES channels(id),
                FOREIGN KEY (group_id) REFERENCES groups(id),
                FOREIGN KEY (dm_receiver_id) REFERENCES users(id)
            )
        `);

        // Reactions table
        db.run(`
            CREATE TABLE IF NOT EXISTS reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emoji TEXT NOT NULL,
                message_id INTEGER,
                user_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES messages(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(message_id, user_id, emoji)
            )
        `);

        // Server members table
        db.run(`
            CREATE TABLE IF NOT EXISTS server_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id INTEGER,
                user_id INTEGER,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (server_id) REFERENCES servers(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(server_id, user_id)
            )
        `);

        // Friends table
        db.run(`
            CREATE TABLE IF NOT EXISTS friends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                friend_id INTEGER,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (friend_id) REFERENCES users(id),
                UNIQUE(user_id, friend_id)
            )
        `);

        console.log('Database initialized successfully');
    });
}

// User operations
const userDB = {
    create: (username, email, hashedPassword) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO users (username, email, password, avatar) VALUES (?, ?, ?, ?)';
            db.run(sql, [username, email, hashedPassword, username.charAt(0).toUpperCase()], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, username, email, avatar: username.charAt(0).toUpperCase() });
            });
        });
    },

    findByEmail: (email) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM users WHERE email = ?';
            db.get(sql, [email], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    findById: (id) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT id, username, email, avatar, status FROM users WHERE id = ?';
            db.get(sql, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    updateStatus: (id, status) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE users SET status = ? WHERE id = ?';
            db.run(sql, [status, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    updateProfile: (id, username, avatar) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE users SET username = ?, avatar = ? WHERE id = ?';
            db.run(sql, [username, avatar, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    updateAvatar: (id, avatarPath) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE users SET avatar = ? WHERE id = ?';
            db.run(sql, [avatarPath, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getAll: () => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT id, username, email, avatar, status FROM users';
            db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

// Message operations
const messageDB = {
    create: (content, userId, channelId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO messages (content, user_id, channel_id) VALUES (?, ?, ?)';
            db.run(sql, [content, userId, channelId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, content, userId, channelId });
            });
        });
    },

    getByChannel: (channelId, limit = 50) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT m.*, u.username, u.avatar 
                FROM messages m 
                JOIN users u ON m.user_id = u.id 
                WHERE m.channel_id = ? 
                ORDER BY m.created_at DESC 
                LIMIT ?
            `;
            db.all(sql, [channelId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.reverse());
            });
        });
    }
};

// Direct message operations
const dmDB = {
    create: (content, senderId, receiverId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO direct_messages (content, sender_id, receiver_id) VALUES (?, ?, ?)';
            db.run(sql, [content, senderId, receiverId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, content, senderId, receiverId });
            });
        });
    },

    getConversation: (userId1, userId2, limit = 50) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT dm.*, u.username, u.avatar 
                FROM direct_messages dm 
                JOIN users u ON dm.sender_id = u.id 
                WHERE (dm.sender_id = ? AND dm.receiver_id = ?) 
                   OR (dm.sender_id = ? AND dm.receiver_id = ?)
                ORDER BY dm.created_at DESC 
                LIMIT ?
            `;
            db.all(sql, [userId1, userId2, userId2, userId1, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.reverse());
            });
        });
    },

    markAsRead: (messageId) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE direct_messages SET read = 1 WHERE id = ?';
            db.run(sql, [messageId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};

// Group Operations
const groupDB = {
    create: (name, ownerId) => {
        return new Promise((resolve, reject) => {
            const icon = name.charAt(0).toUpperCase(); // Default icon
            const sql = 'INSERT INTO groups (name, icon, owner_id) VALUES (?, ?, ?)';
            db.run(sql, [name, icon, ownerId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, name, icon, ownerId });
            });
        });
    },

    update: (groupId, name, icon) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE groups SET name = ?, icon = ? WHERE id = ?';
            db.run(sql, [name, icon, groupId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    delete: (groupId) => {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('DELETE FROM group_messages WHERE group_id = ?', [groupId], (err) => {
                    if (err) return reject(err);
                });
                db.run('DELETE FROM group_members WHERE group_id = ?', [groupId], (err) => {
                    if (err) return reject(err);
                });
                db.run('DELETE FROM file_uploads WHERE group_id = ?', [groupId], (err) => { // Delete associated files
                    if (err) return reject(err);
                });
                db.run('DELETE FROM groups WHERE id = ?', [groupId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    },

    addMember: (groupId, userId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)';
            db.run(sql, [groupId, userId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getGroup: (groupId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM groups WHERE id = ?';
            db.get(sql, [groupId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    
    getGroupCountByOwner: (ownerId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT COUNT(*) as count FROM groups WHERE owner_id = ?';
            db.get(sql, [ownerId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    },

    getUserGroups: (userId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
                FROM groups g
                JOIN group_members gm ON g.id = gm.group_id
                WHERE gm.user_id = ?
                ORDER BY g.created_at DESC
            `;
            db.all(sql, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    getMembers: (groupId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT u.id, u.username, u.avatar, u.status
                FROM users u
                JOIN group_members gm ON u.id = gm.user_id
                WHERE gm.group_id = ?
            `;
            db.all(sql, [groupId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    createMessage: (content, groupId, userId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO group_messages (content, group_id, user_id) VALUES (?, ?, ?)';
            db.run(sql, [content, groupId, userId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, content, groupId, userId });
            });
        });
    },

    getMessages: (groupId, limit = 50) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT gm.*, u.username, u.avatar 
                FROM group_messages gm 
                JOIN users u ON gm.user_id = u.id 
                WHERE gm.group_id = ? 
                ORDER BY gm.created_at DESC 
                LIMIT ?
            `;
            db.all(sql, [groupId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.reverse());
            });
        });
    }
};

// File operations
const fileDB = {
    create: (filename, filepath, filetype, filesize, userId, channelId = null, groupId = null, dmReceiverId = null) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO file_uploads (filename, filepath, filetype, filesize, user_id, channel_id, group_id, dm_receiver_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
            db.run(sql, [filename, filepath, filetype, filesize, userId, channelId, groupId, dmReceiverId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, filename, filepath });
            });
        });
    },

    getByChannel: (channelId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT f.*, u.username 
                FROM file_uploads f 
                JOIN users u ON f.user_id = u.id 
                WHERE f.channel_id = ? 
                ORDER BY f.created_at DESC
            `;
            db.all(sql, [channelId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

// Reaction operations
const reactionDB = {
    add: (emoji, messageId, userId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT OR IGNORE INTO reactions (emoji, message_id, user_id) VALUES (?, ?, ?)';
            db.run(sql, [emoji, messageId, userId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, emoji, messageId, userId });
            });
        });
    },

    remove: (emoji, messageId, userId) => {
        return new Promise((resolve, reject) => {
            const sql = 'DELETE FROM reactions WHERE emoji = ? AND message_id = ? AND user_id = ?';
            db.run(sql, [emoji, messageId, userId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getByMessage: (messageId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT r.emoji, COUNT(*) as count, GROUP_CONCAT(u.username) as users
                FROM reactions r
                JOIN users u ON r.user_id = u.id
                WHERE r.message_id = ?
                GROUP BY r.emoji
            `;
            db.all(sql, [messageId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

// Friend operations
const friendDB = {
    sendRequest: (userId, friendId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "pending")';
            db.run(sql, [userId, friendId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
    },

    acceptRequest: (userId, friendId) => {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // Update the request status
                const sql1 = 'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?';
                db.run(sql1, [friendId, userId], (err) => {
                    if (err) return reject(err);
                });

                // Create reverse relationship
                const sql2 = 'INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")';
                db.run(sql2, [userId, friendId], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    },

    rejectRequest: (userId, friendId) => {
        return new Promise((resolve, reject) => {
            const sql = 'DELETE FROM friends WHERE user_id = ? AND friend_id = ?';
            db.run(sql, [friendId, userId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    removeFriend: (userId, friendId) => {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                const sql1 = 'DELETE FROM friends WHERE user_id = ? AND friend_id = ?';
                const sql2 = 'DELETE FROM friends WHERE user_id = ? AND friend_id = ?';
                
                db.run(sql1, [userId, friendId], (err) => {
                    if (err) return reject(err);
                });
                
                db.run(sql2, [friendId, userId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    },

    getFriends: (userId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT u.id, u.username, u.email, u.avatar, u.status, f.status as friendship_status
                FROM friends f
                JOIN users u ON f.friend_id = u.id
                WHERE f.user_id = ? AND f.status = 'accepted'
            `;
            db.all(sql, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    getPendingRequests: (userId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT u.id, u.username, u.email, u.avatar, u.status
                FROM friends f
                JOIN users u ON f.user_id = u.id
                WHERE f.friend_id = ? AND f.status = 'pending'
            `;
            db.all(sql, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    checkFriendship: (userId, friendId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = "accepted"';
            db.get(sql, [userId, friendId], (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
        });
    }
};

// Server operations
const serverDB = {
    create: (name, ownerId) => {
        return new Promise((resolve, reject) => {
            const icon = name.charAt(0).toUpperCase();
            const sql = 'INSERT INTO servers (name, icon, owner_id) VALUES (?, ?, ?)';
            db.run(sql, [name, icon, ownerId], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, name, icon, ownerId });
            });
        });
    },

    getUserServers: (userId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT s.* FROM servers s
                JOIN server_members sm ON s.id = sm.server_id
                WHERE sm.user_id = ?
                ORDER BY s.created_at ASC
            `;
            db.all(sql, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    addMember: (serverId, userId) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)';
            db.run(sql, [serverId, userId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getMembers: (serverId) => {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT u.id, u.username, u.avatar, u.status
                FROM users u
                JOIN server_members sm ON u.id = sm.user_id
                WHERE sm.server_id = ?
            `;
            db.all(sql, [serverId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

module.exports = {
    db,
    initializeDatabase,
    userDB,
    messageDB,
    dmDB,
    groupDB,
    fileDB,
    reactionDB,
    friendDB,
    serverDB
};