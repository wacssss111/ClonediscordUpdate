
// Global state
let currentChannel = 'general';
let channels = { 'general': [], 'random': [] }; // Note: channels for servers will dynamically load
let servers = [];
let groups = [];
let inCall = false;
let localStream = null;
let screenStream = null;
let isScreenSharing = false;
let peerConnections = {};
let isVideoEnabled = false; // Camera off by default
let isAudioEnabled = true;
let isMuted = false;
let isDeafened = false;
let currentUser = null;
let socket = null;
let token = null;
let currentView = 'friends';
let currentServerId = null;
let currentDMUserId = null;
let currentGroupId = null;
let activeChatTab = 'chat'; // 'chat' or 'participants'
let callStartTime = null; // To store the start time of a call
let currentCallDetails = null; // Stores details about the active call { type: 'dm'|'group'|'server', id: ... }

// Zoom State (per video element)
const zoomStates = new Map();

// Audio elements
const messageAudio = new Audio('assets/keepmess.mp3'); // Changed to keepmess.mp3
const ringingAudio = new Audio('assets/keepsong.mp3'); // Changed to keepsong.mp3
ringingAudio.loop = true;

// Web Audio API context for reliable playback and unlock
let audioContext = null;
let audioUnlocked = false; // Flag to track if audio playback is unlocked

// Page visibility and focus state
let isPageVisible = true;
let isChatFocused = true;

// Call Quality Indicator (Ping)
let pingIntervalId = null;
let usersInVoiceCall = new Map(); // Stores socketId -> { userId, username, avatar }

// Bot user info
const BOT_ID = -1; // Unique ID for the bot
const BOT_USERNAME = 'Bot2'; // Bot's username
const BOT_AVATAR_INITIAL = 'B'; // Bot's default avatar initial

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    token = localStorage.getItem('token');
    const userStr = localStorage.getItem('currentUser');
    
    if (!token || !userStr) {
        window.location.replace('login.html');
        return;
    }
    
    try {
        currentUser = JSON.parse(userStr);
        initializeApp();
    } catch (e) {
        console.error('Error parsing user data:', e);
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        window.location.replace('login.html');
    }
});

function initializeApp() {
    updateUserInfo();
    initializeFriendsTabs();
    initializeChannels();
    initializeMessageInput();
    initializeUserControls();
    initializeCallControls();
    initializeServerManagement();
    initializeGroupManagement();
    initializeFileUpload();
    initializeEmojiPicker();
    initializeDraggableCallWindow();
    initializeBotInteraction(); 
    initializeAudioUnlock(); 
    connectToSocketIO();
    requestNotificationPermission();
    loadUserServers();
    loadUserGroups(); // This will also call populateDMList
    showFriendsView();
    initializeChatTabs(); 

    // Add event listeners for page visibility and focus
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        // When page becomes hidden, stop ringing if it's currently playing and not in active call
        if (!isPageVisible && !inCall) {
             stopRingingSound();
        }
    });

    window.addEventListener('focus', () => {
        isChatFocused = true;
        stopRingingSound();
    });
    window.addEventListener('blur', () => {
        isChatFocused = false;
    });

    // Preload sounds
    messageAudio.load();
    ringingAudio.load();
}

function showTemporaryMessage(message, type = 'success', duration = 3000) {
    let messageEl = document.getElementById('temporaryMessage');
    if (!messageEl) {
        messageEl = document.createElement('div');
        messageEl.id = 'temporaryMessage';
        messageEl.className = 'temporary-message';
        document.body.appendChild(messageEl);
    }

    messageEl.textContent = message;
    messageEl.className = `temporary-message show temporary-message-${type}`;

    setTimeout(() => {
        messageEl.classList.remove('show');
    }, duration);
}

function initializeAudioUnlock() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log("AudioContext created. State:", audioContext.state);
    } catch (e) {
        console.error("AudioContext not supported by this browser.", e);
        showTemporaryMessage("Аудио недоступно в этом браузере.", 'error');
        return;
    }

    const unlockAudio = async () => {
        if (audioUnlocked) return;
        
        console.log("Attempting to unlock audio...");

        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
            } catch (e) {
                console.error("Error resuming AudioContext:", e);
                return;
            }
        }

        try {
            messageAudio.volume = 0.01;
            ringingAudio.volume = 0.01;

            const playPromises = [];
            
            playPromises.push(messageAudio.play().then(() => {
                messageAudio.pause();
                messageAudio.currentTime = 0;
                messageAudio.volume = 1; 
            }).catch(e => console.warn(`Failed to play messageAudio for unlock`)));

            playPromises.push(ringingAudio.play().then(() => {
                ringingAudio.pause();
                ringingAudio.currentTime = 0;
                ringingAudio.volume = 1;
            }).catch(e => console.warn(`Failed to play ringingAudio for unlock`)));

            await Promise.allSettled(playPromises);

            audioUnlocked = true;
            showTemporaryMessage("Звук разблокирован!");
        } catch (e) {
            console.error("Error playing silent audio elements for unlock:", e);
        }

        document.body.removeEventListener('click', unlockAudio);
        document.body.removeEventListener('keydown', unlockAudio);
    };

    if (audioContext.state === 'suspended' || !audioUnlocked) {
        document.body.addEventListener('click', unlockAudio, { once: true });
        document.body.addEventListener('keydown', unlockAudio, { once: true });
        showTemporaryMessage("Нажмите любую клавишу для включения звука.", 'info', 5000);
    } else if (audioContext.state === 'running') {
        audioUnlocked = true;
    }
}


function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/assets/icon.png' });
    }
}

function updateUserInfo() {
    const userAvatarEl = document.querySelector('.user-panel .user-avatar'); 
    const usernameEl = document.querySelector('.user-panel .username');
    const profileAvatarPreview = document.getElementById('profileAvatarPreview');
    const profileUsernameInput = document.getElementById('profileUsernameInput');
    const profileEmailDisplay = document.getElementById('profileEmailDisplay');

    // Update user panel avatar
    if (userAvatarEl) {
        if (currentUser.avatar && currentUser.avatar.startsWith('/uploads/')) {
            userAvatarEl.style.backgroundImage = `url('${currentUser.avatar}')`;
            userAvatarEl.style.backgroundSize = 'cover';
            userAvatarEl.style.backgroundPosition = 'center';
            userAvatarEl.textContent = '';
        } else {
            userAvatarEl.style.backgroundImage = 'none';
            userAvatarEl.textContent = currentUser.avatar || currentUser.username.charAt(0).toUpperCase();
        }
    }
    if (usernameEl) usernameEl.textContent = currentUser.username;

    // Update profile settings modal fields
    if (profileUsernameInput) profileUsernameInput.value = currentUser.username;
    if (profileEmailDisplay) profileEmailDisplay.value = currentUser.email;

    if (profileAvatarPreview) {
        if (currentUser.avatar && currentUser.avatar.startsWith('/uploads/')) {
            profileAvatarPreview.src = currentUser.avatar;
        } else {
            profileAvatarPreview.src = `https://via.placeholder.com/150/5865f2/FFFFFF?text=${currentUser.username.charAt(0).toUpperCase()}`;
        }
    }
}

function connectToSocketIO() {
    if (typeof io !== 'undefined') {
        socket = io({ auth: { token: token } });
        
        socket.on('connect', () => {
            console.log('Connected to server');
            startPingInterval();
        });
        
       socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
        });
        
        socket.on('new-message', (data) => {
            const channelId = data.channelId;
            const channelName = getChannelNameById(channelId);

            if (!channels[channelName]) {
                channels[channelName] = [];
            }
            channels[channelName].push(data.message);
            
            if (channelName === currentChannel && currentView === 'server' && activeChatTab === 'chat') {
                addMessageToUI(data.message);
                scrollToBottom();
            }
            
            const isCurrentChat = (currentView === 'server' && getChannelIdByName(currentChannel) === channelId);
            playMessageSound(isCurrentChat);
            
            if (document.hidden) {
                showNotification('Новое сообщение', `${data.message.author}: ${data.message.text}`);
            }
        });

        // Group Messages
        socket.on('new-group-message', (data) => {
            const isCurrentChat = (currentView === 'group' && currentGroupId === data.groupId);
            if (isCurrentChat && activeChatTab === 'chat') {
                addMessageToUI(data.message);
                scrollToBottom();
            }
            playMessageSound(isCurrentChat);
            if (document.hidden) showNotification('Сообщение в группе', `${data.message.author}: ${data.message.text}`);
        });
        
        socket.on('reaction-update', (data) => {
            updateMessageReactions(data.messageId, data.reactions);
        });

        // WebRTC Signaling
        socket.on('user-joined-voice', (data) => {
            console.log('User joined voice:', data);
            usersInVoiceCall.set(data.socketId, { userId: data.userId, username: data.username, avatar: data.avatar });
            updateCallParticipantsLayout();
            createPeerConnection(data.socketId, true);
        });

        socket.on('existing-voice-users', (users) => {
            users.forEach(user => {
                usersInVoiceCall.set(user.socketId, { userId: user.id, username: user.username, avatar: user.avatar });
                createPeerConnection(user.socketId, false);
            });
            updateCallParticipantsLayout();
        });

        socket.on('user-left-voice', (socketId) => {
            if (peerConnections[socketId]) {
                peerConnections[socketId].close();
                delete peerConnections[socketId];
            }
            usersInVoiceCall.delete(socketId);
            const participantDiv = document.getElementById(`participant-${socketId}`);
            if (participantDiv) participantDiv.remove();
            updateCallParticipantsLayout();
        });

        socket.on('offer', async (data) => {
            if (!peerConnections[data.from]) {
                createPeerConnection(data.from, false);
            }
            const pc = peerConnections[data.from];
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { to: data.from, answer: answer });
        });

        socket.on('answer', async (data) => {
            const pc = peerConnections[data.from];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        });

        socket.on('ice-candidate', async (data) => {
            const pc = peerConnections[data.from];
            if (pc && data.candidate) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });
        
        socket.on('video-toggle', (data) => {
            const participantDiv = document.getElementById(`participant-${data.from}`);
            if (participantDiv) {
                const video = participantDiv.querySelector('video');
                if (video) video.style.opacity = data.enabled ? '1' : '0';
            }
        });

        socket.on('user-speaking', (data) => {
            const participantDiv = document.getElementById(`participant-${data.socketId}`);
            if (participantDiv) {
                if (data.speaking) {
                    participantDiv.classList.add('speaking');
                } else {
                    participantDiv.classList.remove('speaking');
                }
            }
        });

        socket.on('new-dm', (data) => {
            const isCurrentChat = (currentView === 'dm' && data.senderId === currentDMUserId) || (data.senderId === BOT_ID && currentDMUserId === BOT_ID);
            if (isCurrentChat && activeChatTab === 'chat') {
                addMessageToUI({
                    id: data.message.id,
                    author: data.message.author,
                    avatar: data.message.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp,
                    file: data.message.file
                });
                scrollToBottom();
            }
            playMessageSound(isCurrentChat);
        });

        socket.on('dm-sent', (data) => {
            const isCurrentChat = (currentView === 'dm' && data.receiverId === currentDMUserId);
            if (isCurrentChat && activeChatTab === 'chat') {
                addMessageToUI({
                    id: data.message.id,
                    author: currentUser.username,
                    avatar: currentUser.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp,
                    file: data.message.file
                });
                scrollToBottom();
            }
        });

        socket.on('new-friend-request', () => {
            loadPendingRequests();
            showNotification('Новый запрос в друзья', 'У вас новый запрос в друзья!');
        });

        socket.on('incoming-call', (data) => {
            const { from, type } = data;
            if (from) {
                showIncomingCall(from, type);
            }
            playRingingSound(); 
        });

        socket.on('incoming-group-call', (data) => {
            const { groupId, callerInfo, type } = data;
            if (callerInfo) {
                let groupName = 'Группа';
                const group = groups.find(g => g.id === parseInt(groupId));
                if (group) groupName = group.name;
                
                showIncomingCall(callerInfo, type, groupId, groupName);
            }
            playRingingSound();
        });

        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from.username);
            stopRingingSound();
            document.querySelector('.call-channel-name').textContent = `Подключено с ${data.from.username}`;
            
            if (!peerConnections[data.from.socketId]) {
                createPeerConnection(data.from.socketId, true);
            }
        });

        socket.on('group-call-accepted', (data) => {
            console.log('Group call accepted by:', data.from.username);
            stopRingingSound();
            const group = groups.find(g => g.id === data.groupId);
            document.querySelector('.call-channel-name').textContent = `Групповой звонок: ${group ? group.name : 'Unknown Group'}`;
            
            if (!peerConnections[data.from.socketId]) {
                 createPeerConnection(data.from.socketId, true);
            }
        });

        socket.on('call-rejected', (data) => {
            stopRingingSound();
            alert(`Звонок был отклонен: ${data.message || ''}`);
            leaveVoiceChannel(true);
        });
        
        socket.on('group-call-rejected', (data) => {
            stopRingingSound();
        });

        socket.on('call-ended', (data) => {
            stopRingingSound();
            if (peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
            }
            usersInVoiceCall.delete(data.from);
            const participantDiv = document.getElementById(`participant-${data.from}`);
            if (participantDiv) participantDiv.remove();
            
            if (Object.keys(peerConnections).length === 0) {
                leaveVoiceChannel(true);
            }
            updateCallParticipantsLayout();
        });

        socket.on('pong', (clientSendTime) => { 
            const roundTripTime = Date.now() - clientSendTime; 
            const callQualityIndicator = document.getElementById('callQualityIndicator');
            if (callQualityIndicator) {
                callQualityIndicator.textContent = `Ping: ${roundTripTime}ms`;
                if (roundTripTime > 200) {
                    callQualityIndicator.style.color = 'red';
                } else if (roundTripTime > 100) {
                    callQualityIndicator.style.color = 'orange';
                } else {
                    callQualityIndicator.style.color = 'green';
                }
            }
        });

        socket.on('call-start-message', (data) => {
            const isCurrentChat = 
                (data.targetType === 'dm' && currentView === 'dm' && ((currentDMUserId === data.targetId) || (currentDMUserId === data.initiatorId))) ||
                (data.targetType === 'group' && currentView === 'group' && currentGroupId === data.targetId) ||
                (data.targetType === 'server-voice' && currentView === 'server' && getChannelIdByName(currentChannel) === data.targetId);
            
            if (isCurrentChat && activeChatTab === 'chat') {
                addMessageToUI({
                    id: `system-call-start-${Date.now()}`,
                    author: 'Система',
                    avatar: 'S',
                    text: data.message,
                    timestamp: data.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('call-end-message', (data) => {
            const isCurrentChat = 
                (data.targetType === 'dm' && currentView === 'dm' && ((currentDMUserId === data.targetId) || (currentDMUserId === data.initiatorId))) ||
                (data.targetType === 'group' && currentView === 'group' && currentGroupId === data.targetId) ||
                (data.targetType === 'server-voice' && currentView === 'server' && getChannelIdByName(currentChannel) === data.targetId);

            if (isCurrentChat && activeChatTab === 'chat') {
                addMessageToUI({
                    id: `system-call-end-${Date.now()}`,
                    author: 'Система',
                    avatar: 'S',
                    text: data.message,
                    timestamp: data.timestamp
                });
                scrollToBottom();
            }
        });
    }
}

function startPingInterval() {
    if (pingIntervalId) clearInterval(pingIntervalId);
    pingIntervalId = setInterval(() => {
        const clientSendTime = Date.now(); 
        socket.emit('ping', clientSendTime); 
    }, 5000); 
}

function stopPingInterval() {
    if (pingIntervalId) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
    }
}

// Play message sound logic
function playMessageSound(isCurrentChat) {
    if (!audioUnlocked) {
        return;
    }
    messageAudio.volume = 1;
    if (!isPageVisible || (!isChatFocused && !isCurrentChat) || (isChatFocused && !isCurrentChat)) {
        messageAudio.play().catch(e => console.warn(`Failed to play message sound: ${e.name} - ${e.message}`));
    } 
}

function playRingingSound() {
    if (!audioUnlocked) {
        return;
    }
    ringingAudio.volume = 1;
    ringingAudio.play().catch(e => console.warn(`Failed to play ringing sound: ${e.name} - ${e.message}`));
}

function stopRingingSound() {
    if (ringingAudio) { 
        ringingAudio.pause();
        ringingAudio.currentTime = 0;
    }
}

// Initialize friends tabs
function initializeFriendsTabs() {
    const tabs = document.querySelectorAll('.friends-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchFriendsTab(tabName);
        });
    });
    
    const searchBtn = document.getElementById('searchUserBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchUsers);
    }
    
    loadFriends();
}

function switchFriendsTab(tabName) {
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    document.querySelectorAll('.friends-list').forEach(l => l.style.display = 'none');
    const contentMap = {
        'online': 'friendsOnline',
        'all': 'friendsAll',
        'pending': 'friendsPending',
        'add': 'friendsAdd'
    };
    const activeList = document.getElementById(contentMap[tabName]);
    if (activeList) {
        activeList.style.display = 'block';
        document.querySelectorAll('.friends-list').forEach(l => {
            if (l.id === activeList.id) {
                l.removeAttribute('hidden');
            } else {
                l.setAttribute('hidden', 'true');
            }
        });
    }
    
    if (tabName === 'pending') {
        loadPendingRequests();
    } else if (tabName === 'online' || tabName === 'all') {
        loadFriends(); // Reload friends to ensure latest status
    }
}

async function loadFriends() {
    try {
        const response = await fetch('/api/friends', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await response.json();
        displayFriends(friends);
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function displayFriends(friends) {
    const onlineList = document.getElementById('friendsOnline');
    const allList = document.getElementById('friendsAll');
    
    onlineList.innerHTML = '';
    allList.innerHTML = '';
    
    if (friends.length === 0) {
        const emptyMsg = '<div class="friends-empty">В списке друзей никого нет.</div>';
        onlineList.innerHTML = emptyMsg;
        allList.innerHTML = emptyMsg;
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status !== 'Offline');
    
    if (onlineFriends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">Никого нет в сети.</div>';
    } else {
        onlineFriends.forEach(friend => onlineList.appendChild(createFriendElement(friend)));
    }
    
    friends.forEach(friend => allList.appendChild(createFriendElement(friend)));
}

function createFriendElement(friend) {
    const div = document.createElement('div');
    div.className = 'friend-item';
    
    const avatar = friend.avatar && friend.avatar.startsWith('/uploads/') 
        ? `<img src="${friend.avatar}" class="friend-avatar-img" />`
        : `<div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>`;
        
    div.innerHTML = `
        ${avatar}
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${friend.status === 'Offline' ? 'offline' : ''}">${friend.status}</div>
        </div>
        <div class="friend-actions">
            <button class="message" title="Message" data-id="${friend.id}" onclick="startDM(${friend.id}, '${friend.username}', '${friend.avatar}')">💬</button>
            <button class="audio-call" title="Audio Call" onclick="startCall(${friend.id}, 'audio')">📞</button>
            <button class="video-call" title="Video Call" onclick="startCall(${friend.id}, 'video')">📹</button>
            <button class="remove" title="Remove Friend" onclick="removeFriend(${friend.id})">❌</button>
        </div>
    `;
    return div;
}

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const requests = await response.json();
        const list = document.getElementById('friendsPending');
        list.innerHTML = '';
        
        if (requests.length === 0) {
            list.innerHTML = '<div class="friends-empty">Нет ожидающих запросов.</div>';
            return;
        }
        
        requests.forEach(req => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            const avatar = req.avatar && req.avatar.startsWith('/uploads/') 
                ? `<img src="${req.avatar}" class="friend-avatar-img" />`
                : `<div class="friend-avatar">${req.avatar || req.username.charAt(0).toUpperCase()}</div>`;

            div.innerHTML = `
                ${avatar}
                <div class="friend-info">
                    <div class="friend-name">${req.username}</div>
                    <div class="friend-status">Incoming Request</div>
                </div>
                <div class="friend-actions">
                    <button class="accept" title="Accept" onclick="acceptFriend(${req.id})">✅</button>
                    <button class="reject" title="Reject" onclick="rejectFriend(${req.id})">❌</button>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

async function searchUsers() {
    const query = document.getElementById('searchUserInput').value;
    if (!query) return;
    
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await response.json();
        const filtered = users.filter(u => u.username.toLowerCase().includes(query.toLowerCase()) && u.id !== currentUser.id);
        
        const results = document.getElementById('searchResults');
        results.innerHTML = '';
        
        if (filtered.length === 0) {
            results.innerHTML = '<div class="error-message">Пользователь не найден</div>';
            return;
        }
        
        filtered.forEach(user => {
            const div = document.createElement('div');
            div.className = 'user-search-item';
            const avatar = user.avatar && user.avatar.startsWith('/uploads/') 
                ? `<img src="${user.avatar}" class="friend-avatar-img" style="width:32px;height:32px;border-radius:50%;" />`
                : `<div class="friend-avatar" style="width:32px;height:32px;font-size:14px;">${user.avatar || user.username.charAt(0).toUpperCase()}</div>`;

            div.innerHTML = `
                ${avatar}
                <div class="user-info">
                    <div class="user-name">${user.username}</div>
                </div>
                <button class="add-friend-btn" onclick="sendFriendRequest(${user.id})">Добавить</button>
            `;
            results.appendChild(div);
        });
    } catch (error) {
        console.error('Error searching users:', error);
    }
}

async function sendFriendRequest(friendId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            showTemporaryMessage('Запрос отправлен!');
        } else {
            const data = await response.json();
            showTemporaryMessage(data.error || 'Ошибка', 'error');
        }
    } catch (error) {
        console.error('Error sending request:', error);
    }
}

async function acceptFriend(friendId) {
    try {
        await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ friendId })
        });
        loadPendingRequests();
        loadFriends();
    } catch (error) {
        console.error('Error accepting friend:', error);
    }
}

async function rejectFriend(friendId) {
    try {
        await fetch('/api/friends/reject', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ friendId })
        });
        loadPendingRequests();
    } catch (error) {
        console.error('Error rejecting friend:', error);
    }
}

async function removeFriend(friendId) {
    if (!confirm('Вы уверены, что хотите удалить этого друга?')) return;
    
    try {
        await fetch(`/api/friends/${friendId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        loadFriends();
    } catch (error) {
        console.error('Error removing friend:', error);
    }
}

// Group Management
function initializeGroupManagement() {
    // Create Group Modal
    const createGroupBtn = document.getElementById('createGroupBtn');
    const createGroupModal = document.getElementById('createGroupModal');
    const closeCreateGroupBtn = createGroupModal.querySelector('.close-modal-btn');
    const cancelCreateGroupBtn = createGroupModal.querySelector('.cancel-btn');
    const confirmCreateGroupBtn = document.getElementById('confirmCreateGroupBtn');
    
    const closeCreateModal = () => createGroupModal.classList.add('hidden');
    
    closeCreateGroupBtn.addEventListener('click', closeCreateModal);
    cancelCreateGroupBtn.addEventListener('click', closeCreateModal);
    
    createGroupBtn.addEventListener('click', () => {
        createGroupModal.classList.remove('hidden');
        loadFriendsForSelection();
    });
    
    // Edit Group Modal
    const editGroupModal = document.getElementById('editGroupModal');
    const closeEditGroupBtn = editGroupModal.querySelector('.close-modal-btn');
    const cancelEditGroupBtn = editGroupModal.querySelector('.cancel-btn');
    const confirmEditGroupBtn = document.getElementById('confirmEditGroupBtn');
    const deleteGroupBtn = document.getElementById('deleteGroupBtn');

    const closeEditModal = () => editGroupModal.classList.add('hidden');
    closeEditGroupBtn.addEventListener('click', closeEditModal);
    cancelEditGroupBtn.addEventListener('click', closeEditModal);

    // Save Edit Changes
    confirmEditGroupBtn.addEventListener('click', async () => {
        const newName = document.getElementById('editGroupNameInput').value;
        const newIcon = document.getElementById('editGroupIconInput').value;
        
        if (!newName) return alert('Имя группы обязательно');

        try {
            await fetch(`/api/groups/${currentGroupId}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ name: newName, icon: newIcon || newName[0] })
            });
            closeEditModal();
            loadUserGroups();
            // Update current header if active
            document.getElementById('chatHeaderInfo').innerHTML = `
                <span style="font-size: 20px; margin-right: 8px;">#</span>
                <span>${newName}</span>
            `;
        } catch (e) {
            console.error(e);
        }
    });

    // Delete Group
    deleteGroupBtn.addEventListener('click', async () => {
        if (!confirm('Вы уверены, что хотите удалить эту группу?')) return;
        try {
            await fetch(`/api/groups/${currentGroupId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            closeEditModal();
            loadUserGroups();
            showFriendsView(); 
        } catch (e) {
            console.error(e);
        }
    });
    
    // Populate friend selection list
    async function loadFriendsForSelection() {
        const list = document.getElementById('friendSelectionList');
        list.innerHTML = '<div style="text-align:center; padding:10px;">Загрузка...</div>';
        
        try {
            const response = await fetch('/api/friends', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const friends = await response.json();
            
            list.innerHTML = '';
            if (friends.length === 0) {
                list.innerHTML = '<div style="text-align:center; padding:10px;">У вас нет друзей для добавления.</div>';
                return;
            }
            
            friends.forEach(friend => {
                const item = document.createElement('div');
                item.className = 'friend-select-item';
                item.dataset.userId = friend.id;
                
                const avatar = friend.avatar && friend.avatar.startsWith('/uploads/') 
                    ? `<img src="${friend.avatar}" class="friend-avatar-img" />`
                    : `<div class="friend-select-avatar">${friend.avatar || friend.username[0].toUpperCase()}</div>`;
                
                item.innerHTML = `
                    <div class="checkbox"></div>
                    ${avatar}
                    <span>${friend.username}</span>
                `;
                
                item.addEventListener('click', () => {
                    item.classList.toggle('selected');
                });
                
                list.appendChild(item);
            });
        } catch (e) {
            list.innerHTML = 'Ошибка загрузки друзей';
        }
    }

    confirmCreateGroupBtn.addEventListener('click', async () => {
        const groupName = document.getElementById('groupNameInput').value;
        const selectedElements = document.querySelectorAll('.friend-select-item.selected');
        const memberIds = Array.from(selectedElements).map(el => parseInt(el.dataset.userId));

        if (!groupName) {
            alert('Пожалуйста, введите название группы');
            return;
        }
        
        if (memberIds.length < 1) {
            alert('Пожалуйста, выберите хотя бы 1 друга.');
            return;
        }
        if (memberIds.length > 9) {
            alert('Максимальное количество участников группы - 9 (плюс вы).');
            return;
        }

        try {
            const response = await fetch('/api/groups', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name: groupName, members: memberIds })
            });
            
            if (response.ok) {
                closeCreateModal();
                document.getElementById('groupNameInput').value = '';
                loadUserGroups(); // Refresh group list
            } else {
                const data = await response.json();
                alert(data.error || 'Ошибка создания группы');
            }
        } catch (error) {
            console.error('Error creating group:', error);
        }
    });
}

async function loadUserGroups() {
    try {
        const response = await fetch('/api/groups', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        groups = await response.json();
        populateDMList(); // Refresh sidebar list
    } catch (error) {
        console.error('Error loading groups:', error);
    }
}

// Messaging and UI
function initializeMessageInput() {
    const input = document.getElementById('messageInput');
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

async function sendMessage(file = null) {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text && !file) return;
    
    const messageData = {
        text: text,
        file: file,
        timestamp: new Date().toISOString()
    };

    if (currentView === 'server') {
        const channelId = getChannelIdByName(currentChannel);
        socket.emit('send-message', { channelId, message: messageData });
    } else if (currentView === 'dm') {
        socket.emit('send-dm', { receiverId: currentDMUserId, message: messageData, senderId: currentUser.id });
    } else if (currentView === 'group') {
        socket.emit('send-group-message', { groupId: currentGroupId, message: messageData });
    }
    
    input.value = '';
}

function addMessageToUI(msg) {
    const container = document.getElementById('messagesContainer');
    const div = document.createElement('div');
    div.className = 'message-group';
    div.id = `msg-${msg.id}`;
    
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const isUrl = msg.avatar && msg.avatar.startsWith('/uploads/');
    const avatarHtml = isUrl 
        ? `<img src="${msg.avatar}" class="message-avatar-img" />`
        : `<div class="message-avatar">${msg.avatar || msg.author[0]}</div>`;

    let fileHtml = '';
    if (msg.file) {
        if (msg.file.type.startsWith('image/')) {
            fileHtml = `<div class="message-file"><img src="${msg.file.url}" style="max-width: 300px; border-radius: 4px;"></div>`;
        } else {
            fileHtml = `<div class="message-file"><a href="${msg.file.url}" target="_blank">📎 ${msg.file.filename}</a></div>`;
        }
    }

    div.innerHTML = `
        ${avatarHtml}
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${msg.author}</span>
                <span class="message-timestamp">${time}</span>
            </div>
            <div class="message-text">${msg.text}</div>
            ${fileHtml}
            <div class="message-reactions" id="reactions-${msg.id}"></div>
        </div>
        <button class="add-reaction-btn" onclick="toggleEmojiPicker('${msg.id}')">😊</button>
    `;
    
    container.appendChild(div);
    
    if (msg.reactions) {
        updateMessageReactions(msg.id, msg.reactions);
    }
}

function updateMessageReactions(messageId, reactions) {
    const container = document.getElementById(`reactions-${messageId}`);
    if (!container) return;
    
    container.innerHTML = '';
    if (!reactions) return;

    reactions.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'reaction';
        btn.innerHTML = `${r.emoji} <span>${r.count}</span>`;
        btn.title = r.users; 
        btn.onclick = () => toggleReaction(messageId, r.emoji);
        container.appendChild(btn);
    });
}

function toggleReaction(messageId, emoji) {
    socket.emit('add-reaction', { messageId, emoji }); 
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

// Navigation and Views
function showFriendsView() {
    currentView = 'friends';
    document.getElementById('serverName').textContent = 'Friends';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('dmListView').style.display = 'block';
    document.getElementById('channelsView').style.display = 'none';
    document.querySelector('.server-header').style.display = 'flex';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
}

function populateDMList() {
    const dmList = document.getElementById('dmList');
    dmList.innerHTML = '';
    
    fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(friends => {
            // Add Groups first
            groups.forEach(group => {
                const div = document.createElement('div');
                div.className = 'channel';
                
                const avatar = group.icon 
                    ? `<div class="group-chat-avatar">${group.icon}</div>` 
                    : `<div class="group-chat-avatar">${group.name[0]}</div>`;

                div.innerHTML = `${avatar}<span>${group.name}</span>`;
                div.onclick = () => startGroupChat(group);
                dmList.appendChild(div);
            });

            // Add Bot
            const botDiv = document.createElement('div');
            botDiv.className = 'channel';
            botDiv.innerHTML = `<div class="friend-avatar" style="width:24px;height:24px;font-size:12px;margin-right:8px;">B</div><span>Bot2</span>`;
            botDiv.onclick = () => startDM(BOT_ID, BOT_USERNAME, BOT_AVATAR_INITIAL);
            dmList.appendChild(botDiv);

            // Add Friends
            friends.forEach(friend => {
                const div = document.createElement('div');
                div.className = 'channel';
                const avatar = friend.avatar && friend.avatar.startsWith('/uploads/')
                    ? `<img src="${friend.avatar}" class="friend-avatar-img" style="width:24px;height:24px;margin-right:8px;" />`
                    : `<div class="friend-avatar" style="width:24px;height:24px;font-size:12px;margin-right:8px;">${friend.avatar || friend.username[0]}</div>`;
                
                div.innerHTML = `${avatar}<span>${friend.username}</span>`;
                div.onclick = () => startDM(friend.id, friend.username, friend.avatar);
                dmList.appendChild(div);
            });
        });
}

function startDM(userId, username, avatar) {
    currentView = 'dm';
    currentDMUserId = userId;
    currentGroupId = null;
    
    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('chatHeaderInfo').innerHTML = `
        <span style="font-size: 20px; margin-right: 8px;">@</span>
        <span>${username}</span>
    `;
    
    document.getElementById('dmCallAudioBtn').style.display = 'flex';
    document.getElementById('dmCallVideoBtn').style.display = 'flex';
    document.getElementById('groupCallBtn').style.display = 'none';
    document.getElementById('groupSettingsBtn').style.display = 'none';
    
    document.getElementById('dmCallAudioBtn').onclick = () => startCall(userId, 'audio');
    document.getElementById('dmCallVideoBtn').onclick = () => startCall(userId, 'video');

    document.getElementById('messagesContainer').innerHTML = '';
    loadDMMessages(userId);
    
    document.querySelectorAll('.dm-list .channel').forEach(c => c.classList.remove('active'));
}

async function startGroupChat(group) {
    currentView = 'group';
    currentGroupId = group.id;
    currentDMUserId = null;
    
    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('chatHeaderInfo').innerHTML = `
        <span style="font-size: 20px; margin-right: 8px;">#</span>
        <span>${group.name}</span>
    `;
    
    document.getElementById('dmCallAudioBtn').style.display = 'none';
    document.getElementById('dmCallVideoBtn').style.display = 'none';
    document.getElementById('groupCallBtn').style.display = 'flex';
    document.getElementById('groupSettingsBtn').style.display = 'flex';
    
    document.getElementById('groupCallBtn').onclick = () => startGroupCall(group.id);
    document.getElementById('groupSettingsBtn').onclick = () => openGroupSettings(group.id);

    document.getElementById('messagesContainer').innerHTML = '';
    loadGroupMessages(group.id);
}

async function loadDMMessages(userId) {
    try {
        const response = await fetch(`/api/dm/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const messages = await response.json();
        
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        
        messages.forEach(msg => {
            addMessageToUI({
                id: msg.id,
                author: msg.username, 
                avatar: msg.avatar, 
                text: msg.content,
                timestamp: msg.created_at,
            });
        });
        
        scrollToBottom();
    } catch (error) {
        console.error('Error loading DM messages:', error);
    }
}

async function loadGroupMessages(groupId) {
    try {
        const response = await fetch(`/api/groups/${groupId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const messages = await response.json();
        
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';
        
        messages.forEach(msg => {
            addMessageToUI({
                id: msg.id,
                author: msg.username,
                avatar: msg.avatar,
                text: msg.content,
                timestamp: msg.created_at
            });
        });
        
        scrollToBottom();
    } catch (error) {
        console.error('Error loading group messages:', error);
    }
}

// Server Management
function initializeServerManagement() {
    // Basic server navigation
}

function loadUserServers() {
    fetch('/api/servers', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
            servers = data;
            const serverList = document.querySelector('.server-list');
            const friendsBtn = serverList.querySelector('#friendsBtn');
            const separator = serverList.querySelector('.server-separator');
            serverList.innerHTML = '';
            serverList.appendChild(friendsBtn);
            serverList.appendChild(separator);
            
            servers.forEach(server => {
                const div = document.createElement('div');
                div.className = 'server-icon';
                div.textContent = server.icon || server.name[0];
                div.title = server.name;
                div.onclick = () => showServerView(server);
                serverList.appendChild(div);
            });
            
            const addBtn = document.createElement('div');
            addBtn.className = 'server-icon';
            addBtn.innerHTML = '+';
            addBtn.style.color = '#3ba55d'; 
            addBtn.style.backgroundColor = '#36393f';
            addBtn.title = 'Add Server';
            addBtn.onclick = () => {
                const name = prompt('Название сервера:');
                if(name) createServer(name);
            };
            serverList.appendChild(addBtn);
        });
}

async function createServer(name) {
    try {
        await fetch('/api/servers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name })
        });
        loadUserServers();
    } catch (e) {
        console.error(e);
    }
}

function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentChannel = 'general'; 
    
    document.getElementById('serverName').textContent = server.name;
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'flex';
    document.querySelector('.server-header').style.display = 'flex';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    
    document.getElementById('chatHeaderInfo').innerHTML = `
        <span style="font-size: 20px; margin-right: 8px;">#</span>
        <span>general</span>
    `;
    
    document.getElementById('dmCallAudioBtn').style.display = 'none';
    document.getElementById('dmCallVideoBtn').style.display = 'none';
    document.getElementById('groupCallBtn').style.display = 'none';
    document.getElementById('groupSettingsBtn').style.display = 'none';

    document.getElementById('messagesContainer').innerHTML = '';
}

function initializeChannels() {
    const channelsEl = document.querySelectorAll('.channel');
    channelsEl.forEach(ch => {
        ch.addEventListener('click', () => {
            if (currentView === 'server') {
                document.querySelectorAll('.channel').forEach(c => c.classList.remove('active'));
                ch.classList.add('active');
                
                const channelName = ch.getAttribute('data-channel');
                const isVoice = ch.classList.contains('voice-channel');
                
                if (isVoice) {
                    joinVoiceChannel(channelName);
                } else {
                    currentChannel = channelName;
                    document.getElementById('chatHeaderInfo').innerHTML = `
                        <span style="font-size: 20px; margin-right: 8px;">#</span>
                        <span>${ch.querySelector('span').textContent}</span>
                    `;
                }
            }
        });
    });
}

function getChannelIdByName(name) {
    const map = { 'general': 1, 'random': 2, 'voice-1': 3, 'voice-2': 4 };
    return map[name] || 1;
}
function getChannelNameById(id) {
    const map = { 1: 'general', 2: 'random', 3: 'voice-1', 4: 'voice-2' };
    return map[id] || 'general';
}

// Call Functions
function startCall(userId, type) {
    callStartTime = new Date().toISOString();
    currentCallDetails = { type: 'dm', friendId: userId };
    
    const myInfo = { id: currentUser.id, username: currentUser.username, avatar: currentUser.avatar, socketId: socket.id };
    socket.emit('initiate-call', { to: userId, from: myInfo, type: type, startTime: callStartTime });
    
    showCallInterface();
}

function startGroupCall(groupId) {
    callStartTime = new Date().toISOString();
    currentCallDetails = { type: 'group', groupId: groupId };
    
    const myInfo = { id: currentUser.id, username: currentUser.username, avatar: currentUser.avatar }; 
    
    socket.emit('initiate-group-call', { groupId: groupId, callerInfo: myInfo, type: 'audio', startTime: callStartTime });
    showCallInterface();
}

function joinVoiceChannel(channelName) {
    callStartTime = new Date().toISOString();
    currentCallDetails = { type: 'server', channelName: channelName };
    
    socket.emit('join-voice-channel', { 
        channelName: channelName, 
        userId: currentUser.id, 
        username: currentUser.username, 
        avatar: currentUser.avatar,
        startTime: callStartTime
    });
    showCallInterface();
}

function leaveVoiceChannel(endCall = false) {
    if (inCall) {
        if (currentCallDetails?.type === 'server') {
            socket.emit('leave-voice-channel', currentCallDetails.channelName);
        } else if (currentCallDetails?.type === 'dm') {
            socket.emit('end-call', { to: currentCallDetails.friendId });
        } else if (currentCallDetails?.type === 'group') {
            socket.emit('leave-group-voice', { groupId: currentCallDetails.groupId });
        }
        
        inCall = false;
        isScreenSharing = false;
        
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        usersInVoiceCall.clear();
        
        document.getElementById('callInterface').classList.add('hidden');
        document.getElementById('remoteParticipants').innerHTML = '';
        document.getElementById('toggleScreenBtn').classList.remove('active');
        document.getElementById('toggleVideoBtn').disabled = false;
        
        currentCallDetails = null;
        stopPingInterval();
    }
}

// WebRTC
function createPeerConnection(socketId, isInitiator) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    peerConnections[socketId] = pc;
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { to: socketId, candidate: event.candidate });
        }
    };
    
    pc.ontrack = (event) => {
        addRemoteStream(socketId, event.streams[0]);
    };
    
    const streamToSend = isScreenSharing && screenStream ? screenStream : localStream;
    if (streamToSend) {
        streamToSend.getTracks().forEach(track => pc.addTrack(track, streamToSend));
    }
    
    if (isInitiator) {
        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            socket.emit('offer', { to: socketId, offer: offer });
        });
    }
    
    return pc;
}

function addRemoteStream(socketId, stream) {
    let div = document.getElementById(`participant-${socketId}`);
    if (!div) {
        const userInfo = usersInVoiceCall.get(socketId);
        div = document.createElement('div');
        div.className = 'participant';
        div.id = `participant-${socketId}`;
        div.innerHTML = `
            <div class="zoom-container">
                <video autoplay playsinline></video>
            </div>
            <div class="participant-name">${userInfo ? userInfo.username : 'User'}</div>
        `;
        document.getElementById('remoteParticipants').appendChild(div);
        
        div.querySelector('video').addEventListener('dblclick', (e) => toggleZoom(e.target));
    }
    
    const video = div.querySelector('video');
    video.srcObject = stream;
    updateCallParticipantsLayout();
}

// UI Logic for Call Interface
function showCallInterface() {
    inCall = true;
    document.getElementById('callInterface').classList.remove('hidden');
    
    navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoEnabled })
        .then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;
            document.getElementById('localVideo').muted = true;
            
            Object.values(peerConnections).forEach(pc => {
                stream.getTracks().forEach(track => pc.addTrack(track, stream));
            });
        })
        .catch(err => console.error('Error accessing media:', err));
}

function updateCallParticipantsLayout() {
    const container = document.getElementById('callParticipantsContainer');
    const count = 1 + usersInVoiceCall.size; // Local + Remotes
    
    let columns = 1;
    if (count > 1) columns = 2;
    if (count > 4) columns = 3;
    
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
}

function initializeCallControls() {
    document.getElementById('toggleVideoBtn').addEventListener('click', () => {
        if(isScreenSharing) return; // Disable camera toggle while screen sharing

        isVideoEnabled = !isVideoEnabled;
        if (localStream) {
            localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
            
            if (isVideoEnabled && localStream.getVideoTracks().length === 0) {
                 navigator.mediaDevices.getUserMedia({ video: true }).then(vStream => {
                     const videoTrack = vStream.getVideoTracks()[0];
                     localStream.addTrack(videoTrack);
                     document.getElementById('localVideo').srcObject = localStream;
                     Object.values(peerConnections).forEach(pc => pc.addTrack(videoTrack, localStream));
                 });
            }
        }
        document.getElementById('toggleVideoBtn').classList.toggle('active', !isVideoEnabled);
        socket.emit('video-toggle', { enabled: isVideoEnabled });
    });
    
    document.getElementById('toggleAudioBtn').addEventListener('click', () => {
        isMuted = !isMuted;
        if (localStream) {
            localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        }
        document.getElementById('toggleAudioBtn').classList.toggle('active', isMuted);
    });
    
    document.getElementById('closeCallBtn').addEventListener('click', () => {
        leaveVoiceChannel(true);
    });

    // Screen Sharing Logic
    document.getElementById('toggleScreenBtn').addEventListener('click', async () => {
        if (!inCall) return;

        if (!isScreenSharing) {
            try {
                screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                
                Object.values(peerConnections).forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                    else pc.addTrack(screenTrack, screenStream); // Add if no video track existed
                });

                document.getElementById('localVideo').srcObject = screenStream;
                
                screenTrack.onended = () => {
                    stopScreenSharing();
                };

                isScreenSharing = true;
                document.getElementById('toggleScreenBtn').classList.add('active');
                document.getElementById('toggleVideoBtn').disabled = true; 
            } catch (e) {
                console.error("Error sharing screen:", e);
            }
        } else {
            stopScreenSharing();
        }
    });
}

function stopScreenSharing() {
    if (!isScreenSharing) return;
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
             Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);
            });
        }
        document.getElementById('localVideo').srcObject = localStream;
        // Re-apply video enabled state
        localStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
    }

    isScreenSharing = false;
    document.getElementById('toggleScreenBtn').classList.remove('active');
    document.getElementById('toggleVideoBtn').disabled = false;
}

function showIncomingCall(caller, type, groupId = null, groupName = null) {
    const callModal = document.getElementById('incomingCall');
    callModal.classList.remove('hidden');
    
    const title = document.getElementById('incomingCallHeader');
    const msg = document.getElementById('incomingCallMessage');
    const avatar = callModal.querySelector('.caller-avatar');
    
    if (groupId) {
        title.textContent = groupName || 'Групповой звонок';
        msg.textContent = `${caller.username} звонит в группу...`;
        avatar.textContent = (groupName || 'G')[0];
    } else {
        title.textContent = caller.username;
        msg.textContent = `Входящий ${type === 'video' ? 'видео' : 'аудио'} звонок...`;
        avatar.textContent = caller.username[0];
    }
    
    callModal.dataset.callerId = caller.socketId || caller.id; 
    callModal.dataset.groupId = groupId;
}

document.getElementById('acceptCallBtn').addEventListener('click', () => {
    const modal = document.getElementById('incomingCall');
    const groupId = modal.dataset.groupId;
    const callerId = modal.dataset.callerId; 
    
    modal.classList.add('hidden');
    stopRingingSound();
    
    callStartTime = new Date().toISOString();
    
    if (groupId && groupId !== 'null') {
        currentCallDetails = { type: 'group', groupId: parseInt(groupId) };
        const myInfo = { id: currentUser.id, username: currentUser.username, avatar: currentUser.avatar };
        socket.emit('accept-group-call', { groupId: parseInt(groupId), from: myInfo, startTime: callStartTime });
    } else {
        const myInfo = { id: currentUser.id, username: currentUser.username, avatar: currentUser.avatar, socketId: socket.id };
        socket.emit('accept-call', { to: callerId, from: myInfo, startTime: callStartTime });
        currentCallDetails = { type: 'dm', friendId: null };
    }
    
    showCallInterface();
});

document.getElementById('rejectCallBtn').addEventListener('click', () => {
    const modal = document.getElementById('incomingCall');
    const groupId = modal.dataset.groupId;
    const callerId = modal.dataset.callerId;
    
    modal.classList.add('hidden');
    stopRingingSound();
    
    const myInfo = { id: currentUser.id, username: currentUser.username };
    
    if (groupId && groupId !== 'null') {
        socket.emit('reject-group-call', { groupId: parseInt(groupId), to: callerId, from: myInfo, message: 'Busy' });
    } else {
        socket.emit('reject-call', { to: callerId, message: 'Busy' });
    }
});

// File Upload Logic
function initializeFileUpload() {
    const attachBtn = document.querySelector('.attach-btn');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        handleFileUpload(file);
        fileInput.value = ''; 
    });

    // Drag and Drop Logic
    const dropZone = document.getElementById('messageInputContainer');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('drag-over'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    }, false);
}

async function handleFileUpload(file) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
        alert('Файл слишком большой (максимум 10MB)');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    
    if (currentView === 'server') {
        formData.append('channelId', getChannelIdByName(currentChannel));
    } else if (currentView === 'dm') {
        formData.append('dmReceiverId', currentDMUserId);
    } else if (currentView === 'group') {
        formData.append('groupId', currentGroupId);
    }

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const data = await response.json();
        
        if (response.ok) {
            sendMessage(data); 
        } else {
            alert('Ошибка загрузки файла');
        }
    } catch (e) {
        console.error(e);
        alert('Ошибка загрузки файла');
    }
}

// Emoji Picker Logic
let currentEmojiMessageId = null;
function initializeEmojiPicker() {
    const emojiBtn = document.querySelector('.emoji-btn');
    const picker = document.createElement('div');
    picker.className = 'emoji-picker hidden';
    picker.style.display = 'none';
    
    const emojis = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉', '🔥', '👀', '✅', '❌'];
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = emoji;
        btn.onclick = () => {
            if (currentEmojiMessageId) {
                toggleReaction(currentEmojiMessageId, emoji);
                currentEmojiMessageId = null;
                picker.style.display = 'none';
            } else {
                const input = document.getElementById('messageInput');
                input.value += emoji;
                input.focus();
                picker.style.display = 'none';
            }
        };
        picker.appendChild(btn);
    });
    
    document.body.appendChild(picker);

    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentEmojiMessageId = null; 
        const rect = emojiBtn.getBoundingClientRect();
        picker.style.left = `${rect.left}px`;
        picker.style.bottom = `${window.innerHeight - rect.top + 10}px`;
        picker.style.top = 'auto';
        picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target) && !e.target.closest('.emoji-btn') && !e.target.closest('.add-reaction-btn')) {
            picker.style.display = 'none';
            currentEmojiMessageId = null;
        }
    });
}

window.toggleEmojiPicker = function(messageId) {
    currentEmojiMessageId = messageId;
    const picker = document.querySelector('.emoji-picker');
    const btn = document.querySelector(`#msg-${messageId} .add-reaction-btn`);
    if(btn) {
        const rect = btn.getBoundingClientRect();
        picker.style.left = `${rect.left - 200}px`; 
        picker.style.top = `${rect.top + 30}px`;
        picker.style.bottom = 'auto';
        picker.style.display = 'grid';
    }
};

// Draggable Call Window
function initializeDraggableCallWindow() {
    const callInterface = document.getElementById('callInterface');
    const header = callInterface.querySelector('.call-header');
    
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    header.addEventListener("mousedown", dragStart);
    document.addEventListener("mouseup", dragEnd);
    document.addEventListener("mousemove", drag);

    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (e.target === header || header.contains(e.target)) {
            if (!e.target.closest('button')) {
                isDragging = true;
            }
        }
    }

    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            xOffset = currentX;
            yOffset = currentY;

            setTranslate(currentX, currentY, callInterface);
        }
    }

    function setTranslate(xPos, yPos, el) {
        el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
    }
}

// Bot Interaction
function initializeBotInteraction() {
    const fab = document.getElementById('botFab');
    const modal = document.getElementById('botInteractionModal');
    const closeBtn = modal.querySelector('.close-modal-btn');
    
    fab.addEventListener('click', () => {
        modal.classList.remove('hidden');
    });
    
    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });
    
    document.getElementById('botSendMessageBtn').addEventListener('click', () => {
        if (currentView === 'dm') {
            socket.emit('send-dm', { 
                receiverId: currentDMUserId, 
                message: { text: "Привет! Я бот.", timestamp: new Date().toISOString() }, 
                senderId: BOT_ID 
            });
        } else {
            alert('Сначала откройте личные сообщения с ботом или другом.');
        }
        modal.classList.add('hidden');
    });
}

// Chat Tabs
function initializeChatTabs() {
    const tabs = document.querySelectorAll('.chat-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const target = tab.getAttribute('data-chat-tab');
            activeChatTab = target;
            
            if (target === 'chat') {
                document.getElementById('messagesContainer').style.display = 'block';
                document.getElementById('participantsListView').style.display = 'none';
                document.getElementById('messageInputContainer').style.display = 'block';
                scrollToBottom();
            } else {
                document.getElementById('messagesContainer').style.display = 'none';
                document.getElementById('participantsListView').style.display = 'block';
                document.getElementById('messageInputContainer').style.display = 'none';
                loadParticipantsList(); 
            }
        });
    });
}

function loadParticipantsList() {
    const container = document.getElementById('participantsListView');
    container.innerHTML = '';
    
    if (currentView === 'group') {
        fetch(`/api/groups/${currentGroupId}/members`, { headers: { 'Authorization': `Bearer ${token}` }})
            .then(res => res.json())
            .then(members => {
                members.forEach(member => {
                    const div = document.createElement('div');
                    div.className = 'channel';
                    div.innerHTML = `<span style="margin-left: 10px;">${member.username}</span>`;
                    container.appendChild(div);
                });
            });
    } else {
        container.innerHTML = '<div style="padding:20px; color:#aaa;">Участники доступны только в группах.</div>';
    }
}

// User Controls
function initializeUserControls() {
    const settingsBtn = document.getElementById('settingsBtn');
    const modal = document.getElementById('profileSettingsModal');
    const closeBtn = modal.querySelector('.close-modal-btn');
    const cancelBtn = modal.querySelector('.cancel-btn');
    const saveBtn = document.getElementById('saveProfileBtn');
    
    // Avatar upload preview logic
    const avatarInput = document.getElementById('profileAvatarInput');
    const avatarPreview = document.getElementById('profileAvatarPreview');

    avatarInput.addEventListener('change', () => {
        const file = avatarInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                avatarPreview.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    settingsBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        updateUserInfo(); 
    });
    
    const closeModal = () => modal.classList.add('hidden');
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    
    saveBtn.addEventListener('click', async () => {
        const newUsername = document.getElementById('profileUsernameInput').value;
        const avatarFile = avatarInput.files[0];

        try {
            // Update username first
            await fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                },
                body: JSON.stringify({ username: newUsername })
            });

            // Update avatar if selected
            if (avatarFile) {
                const formData = new FormData();
                formData.append('avatar', avatarFile);
                await fetch('/api/user/avatar', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
            }
            
            // Reload user info
            const updatedUser = await fetch('/api/user/profile', { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json());
            currentUser = updatedUser;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            updateUserInfo();
            closeModal();
            
        } catch(e) {
            console.error(e);
            alert("Ошибка сохранения профиля");
        }
    });
}

function toggleZoom(element) {
    if (!zoomStates.has(element)) {
        zoomStates.set(element, false);
    }
    
    const isZoomed = zoomStates.get(element);
    if (!isZoomed) {
        element.style.transform = 'scale(1.5)';
        zoomStates.set(element, true);
    } else {
        element.style.transform = 'scale(1)';
        zoomStates.set(element, false);
    }
}

function openGroupSettings(groupId) {
    const group = groups.find(g => g.id === groupId);
    if(group && group.owner_id === currentUser.id) {
        const editModal = document.getElementById('editGroupModal');
        document.getElementById('editGroupNameInput').value = group.name;
        document.getElementById('editGroupIconInput').value = group.icon || '';
        editModal.classList.remove('hidden');
    } else {
        alert('Только владелец может управлять группой.');
    }
}

// End of script.js
