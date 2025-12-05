

// Global state
let currentChannel = 'general';
let channels = { 'general': [], 'random': [] }; // Note: channels for servers will dynamically load
let servers = [];
let groups = [];
let inCall = false;
let localStream = null;
let screenStream = null;
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

// Zoom State (per video element)
const zoomStates = new Map();

// Audio elements
const messageAudio = new Audio('assets/keepsong.mp3');
const ringingAudio = new Audio('assets/kellsond.mp3');
ringingAudio.loop = true;

// Page visibility and focus state
let isPageVisible = true;
let isChatFocused = true;

// Call Quality Indicator (Ping)
let pingIntervalId = null;
let lastPingTime = 0;
let usersInVoiceCall = new Map(); // Stores socketId -> { userId, username, avatar }


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
    connectToSocketIO();
    requestNotificationPermission();
    loadUserServers();
    loadUserGroups();
    showFriendsView();
    initializeChatTabs(); // Initialize chat tabs

    // Add event listeners for page visibility and focus
    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        if (!isPageVisible) {
            // Pause ringing sound if tab loses focus and it's playing
            if (ringingAudio.paused) {
                ringingAudio.pause();
                ringingAudio.currentTime = 0;
            }
        }
    });

    window.addEventListener('focus', () => {
        isChatFocused = true;
        // Stop ringing sound when window regains focus
        stopRingingSound();
    });
    window.addEventListener('blur', () => {
        isChatFocused = false;
    });

    // Preload sounds
    messageAudio.load();
    ringingAudio.load();
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
    const userAvatar = document.querySelector('.user-avatar');
    const username = document.querySelector('.username');
    const profileAvatarPreview = document.getElementById('profileAvatarPreview');
    const profileUsernameInput = document.getElementById('profileUsernameInput');
    const profileEmailDisplay = document.getElementById('profileEmailDisplay');

    if (userAvatar) {
        if (currentUser.avatar && currentUser.avatar.startsWith('/uploads/')) {
            userAvatar.style.backgroundImage = `url('${currentUser.avatar}')`;
            userAvatar.style.backgroundSize = 'cover';
            userAvatar.textContent = '';
        } else {
            userAvatar.style.backgroundImage = 'none';
            userAvatar.textContent = currentUser.avatar || currentUser.username.charAt(0).toUpperCase();
        }
    }
    if (username) username.textContent = currentUser.username;
    if (profileUsernameInput) profileUsernameInput.value = currentUser.username;
    if (profileEmailDisplay) profileEmailDisplay.value = currentUser.email;

    if (profileAvatarPreview) {
        if (currentUser.avatar && currentUser.avatar.startsWith('/uploads/')) {
            profileAvatarPreview.src = currentUser.avatar;
            profileAvatarPreview.alt = `Аватар ${currentUser.username}`;
        } else {
            // Default avatar based on first letter or a placeholder image
            profileAvatarPreview.src = `https://via.placeholder.com/150/5865f2/FFFFFF?text=${currentUser.username.charAt(0).toUpperCase()}`;
            profileAvatarPreview.alt = `Аватар ${currentUser.username.charAt(0).toUpperCase()}`;
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
            
            // Check if sound should play for server message
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
            
            // Check if sound should play for group message
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
            // Update UI when peer toggles video
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
            const isCurrentChat = (currentView === 'dm' && data.senderId === currentDMUserId);
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
        });

        socket.on('incoming-group-call', (data) => {
            const { groupId, callerInfo, type } = data;
            if (callerInfo) {
                showIncomingCall(callerInfo, type, groupId);
            }
        });

        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from.username);
            stopRingingSound();
            document.querySelector('.call-channel-name').textContent = `Подключено с ${data.from.username}`;
            
            // Create peer connection as initiator
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
            alert(`Групповой звонок был отклонен: ${data.message || ''}`);
            leaveVoiceChannel(true);
        });

        socket.on('call-ended', (data) => {
            stopRingingSound();
            // Handle when other party ends the call
            if (peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
            }
            usersInVoiceCall.delete(data.from);
            const participantDiv = document.getElementById(`participant-${data.from}`);
            if (participantDiv) participantDiv.remove();
            
            // If no more connections, end the call
            if (Object.keys(peerConnections).length === 0) {
                leaveVoiceChannel(true);
            }
            updateCallParticipantsLayout();
        });

        socket.on('pong', (ms) => {
            const callQualityIndicator = document.getElementById('callQualityIndicator');
            if (callQualityIndicator) {
                callQualityIndicator.textContent = `Ping: ${ms}ms`;
                if (ms > 200) {
                    callQualityIndicator.style.color = 'red';
                } else if (ms > 100) {
                    callQualityIndicator.style.color = 'orange';
                } else {
                    callQualityIndicator.style.color = 'green';
                }
            }
        });
    }
}

function startPingInterval() {
    if (pingIntervalId) clearInterval(pingIntervalId);
    pingIntervalId = setInterval(() => {
        lastPingTime = Date.now();
        socket.emit('ping');
    }, 5000); // Ping every 5 seconds
}

function stopPingInterval() {
    if (pingIntervalId) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
    }
}

// Play message sound logic
function playMessageSound(isCurrentChat) {
    if (!isPageVisible || (!isChatFocused && !isCurrentChat) || (isChatFocused && !isCurrentChat)) {
        messageAudio.play().catch(e => console.warn("Failed to play message sound:", e));
    }
}

function playRingingSound() {
    ringingAudio.play().catch(e => console.warn("Failed to play ringing sound:", e));
}

function stopRingingSound() {
    ringingAudio.pause();
    ringingAudio.currentTime = 0;
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
        // We will populate DMs and Groups separately
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function displayFriends(friends) {
    const onlineList = document.getElementById('friendsOnline');
    const allList = document.getElementById('friendsAll');
    
    onlineList.innerHTML = '';
    allList.innerHTML = '';
    
    // Also populate DM list here for now
    populateDMList(friends);

    if (friends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">Пока нет друзей</div>';
        allList.innerHTML = '<div class="friends-empty">Пока нет друзей</div>';
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status === 'Online');
    
    if (onlineFriends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">Никто не в сети</div>';
    } else {
        onlineFriends.forEach(friend => {
            onlineList.appendChild(createFriendItem(friend));
        });
    }
    
    friends.forEach(friend => {
        allList.appendChild(createFriendItem(friend));
    });
}

function createFriendItem(friend) {
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.setAttribute('role', 'listitem');
    
    const avatarImg = friend.avatar && friend.avatar.startsWith('/uploads/') 
        ? `<img src="${friend.avatar}" alt="Аватар ${friend.username}" class="friend-avatar-img">`
        : `<div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>`;

    div.innerHTML = `
        ${avatarImg}
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${friend.status === 'Online' ? '' : 'offline'}">${friend.status}</div>
        </div>
        <div class="friend-actions">
            <button class="friend-action-btn message" title="Сообщение" aria-label="Отправить сообщение ${friend.username}">💬</button>
            <button class="friend-action-btn audio-call" title="Аудиозвонок" aria-label="Начать аудиозвонок с ${friend.username}">📞</button>
            <button class="friend-action-btn video-call" title="Видеозвонок" aria-label="Начать видеозвонок с ${friend.username}">📹</button>
            <button class="friend-action-btn remove" title="Удалить" aria-label="Удалить ${friend.username} из друзей">🗑️</button>
        </div>
    `;

    div.querySelector('.message').addEventListener('click', () => startDM(friend.id, friend.username, friend.avatar));
    div.querySelector('.audio-call').addEventListener('click', () => initiateCall(friend.id, friend.username, 'audio', friend.avatar));
    div.querySelector('.video-call').addEventListener('click', () => initiateCall(friend.id, friend.username, 'video', friend.avatar));
    div.querySelector('.remove').addEventListener('click', () => removeFriend(friend.id, friend.username));
    
    return div;
}

async function searchUsers() {
    const searchInput = document.getElementById('searchUserInput');
    const query = searchInput.value.trim();
    
    if (!query) {
        showErrorInFriendsAdd('Введите имя пользователя для поиска.');
        return;
    }

    if (query.toLowerCase() === currentUser.username.toLowerCase()) {
        showErrorInFriendsAdd('Вы не можете добавить себя в друзья.');
        return;
    }
    
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await response.json();
        
        const results = users.filter(u => 
            u.username.toLowerCase().includes(query.toLowerCase()) && 
            u.id !== currentUser.id
        );
        
        displaySearchResults(results);
    } catch (error) {
        console.error('Error searching users:', error);
        showErrorInFriendsAdd('Ошибка поиска пользователей.');
    }
}

function displaySearchResults(users) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    
    if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="friends-empty">Пользователи не найдены</div>';
        return;
    }
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-search-item';
        div.setAttribute('role', 'listitem');

        const avatarImg = user.avatar && user.avatar.startsWith('/uploads/') 
            ? `<img src="${user.avatar}" alt="Аватар ${user.username}" class="friend-avatar-img">`
            : `<div class="friend-avatar">${user.avatar || user.username.charAt(0).toUpperCase()}</div>`;
        
        div.innerHTML = `
            ${avatarImg}
            <div class="user-info">
                <div class="user-name">${user.username}</div>
            </div>
            <button class="add-friend-btn" onclick="sendFriendRequest(${user.id}, '${user.username}')" aria-label="Отправить запрос в друзья"></button>
        `;
        
        resultsDiv.appendChild(div);
    });
}

window.sendFriendRequest = async function(friendId, friendUsername) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            showSuccessInFriendsAdd(`Запрос в друзья отправлен ${friendUsername}!`);
            loadPendingRequests(); // Refresh pending requests list
        } else {
            const errorData = await response.json();
            showErrorInFriendsAdd(`Не могу добавить друга: ${errorData.error || 'Неизвестная ошибка'}`);
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        showErrorInFriendsAdd('Не могу добавить друга: Ошибка сети.');
    }
};

function showErrorInFriendsAdd(message) {
    const searchResults = document.getElementById('searchResults');
    let errorDiv = searchResults.querySelector('.error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.setAttribute('role', 'alert');
        searchResults.insertBefore(errorDiv, searchResults.firstChild);
    }
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
    setTimeout(() => errorDiv.classList.remove('show'), 3000);
}

function showSuccessInFriendsAdd(message) {
    const searchResults = document.getElementById('searchResults');
    let successDiv = searchResults.querySelector('.success-message');
    if (!successDiv) {
        successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.setAttribute('role', 'status');
        searchResults.insertBefore(successDiv, searchResults.firstChild);
    }
    successDiv.textContent = message;
    successDiv.classList.add('show');
    setTimeout(() => successDiv.classList.remove('show'), 3000);
}

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const requests = await response.json();
        
        const pendingList = document.getElementById('friendsPending');
        pendingList.innerHTML = '';
        
        if (requests.length === 0) {
            pendingList.innerHTML = '<div class="friends-empty">Запросов в друзья нет</div>';
            return;
        }
        
        requests.forEach(request => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            div.setAttribute('role', 'listitem');

            const avatarImg = request.avatar && request.avatar.startsWith('/uploads/') 
                ? `<img src="${request.avatar}" alt="Аватар ${request.username}" class="friend-avatar-img">`
                : `<div class="friend-avatar">${request.avatar || request.username.charAt(0).toUpperCase()}</div>`;
            
            div.innerHTML = `
                ${avatarImg}
                <div class="friend-info">
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Входящий запрос в друзья</div>
                </div>
                <div class="friend-actions">
                    <button class="friend-action-btn accept" onclick="acceptFriendRequest(${request.id})" title="Принять" aria-label="Принять запрос от ${request.username}">✓</button>
                    <button class="friend-action-btn reject" onclick="rejectFriendRequest(${request.id})" title="Отклонить" aria-label="Отклонить запрос от ${request.username}">✕</button>
                </div>
            `;
            
            pendingList.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

window.acceptFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
            loadFriends();
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
    }
};

window.rejectFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/reject', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
        }
    } catch (error) {
        console.error('Error rejecting friend request:', error);
    }
};

window.removeFriend = async function(friendId, friendUsername) {
    if (!confirm(`Вы уверены, что хотите удалить ${friendUsername} из друзей?`)) return;
    
    try {
        const response = await fetch(`/api/friends/${friendId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            loadFriends();
            // If currently in DM with this friend, switch to friends view
            if (currentView === 'dm' && currentDMUserId === friendId) {
                showFriendsView();
            }
        }
    } catch (error) {
        console.error('Error removing friend:', error);
    }
};

// === GROUP MANAGEMENT ===

function initializeGroupManagement() {
    const createGroupBtn = document.getElementById('createGroupBtn');
    const createGroupModal = document.getElementById('createGroupModal');
    const closeCreateGroupModalBtn = createGroupModal.querySelector('.close-modal-btn');
    const cancelCreateGroupBtn = createGroupModal.querySelector('.cancel-btn');
    const confirmCreateGroupBtn = createGroupModal.querySelector('.create-btn');

    const groupSettingsBtn = document.getElementById('groupSettingsBtn');
    const editGroupModal = document.getElementById('editGroupModal');
    const closeEditGroupModalBtn = editGroupModal.querySelector('.close-modal-btn');
    const cancelEditGroupBtn = editGroupModal.querySelector('.cancel-btn');
    const confirmEditGroupBtn = editGroupModal.querySelector('.create-btn');
    const deleteGroupBtn = document.getElementById('deleteGroupBtn');


    createGroupBtn.addEventListener('click', async () => {
        document.getElementById('groupNameInput').value = ''; // Clear input
        createGroupModal.classList.remove('hidden');
        await populateFriendSelection();
    });

    closeCreateGroupModalBtn.addEventListener('click', () => createGroupModal.classList.add('hidden'));
    cancelCreateGroupBtn.addEventListener('click', () => createGroupModal.classList.add('hidden'));

    confirmCreateGroupBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('groupNameInput');
        const name = nameInput.value.trim();
        if(!name) return alert('Пожалуйста, введите название группы');

        const selectedFriends = Array.from(document.querySelectorAll('.friend-select-item.selected'))
            .map(el => parseInt(el.dataset.id));
        
        if(selectedFriends.length > 9) return alert('Разрешено максимум 9 друзей (всего 10, включая вас)');

        await createGroup(name, selectedFriends);
        createGroupModal.classList.add('hidden');
        nameInput.value = '';
    });

    // Group settings / Edit functionality
    if (groupSettingsBtn) {
        groupSettingsBtn.addEventListener('click', async () => {
            if (!currentGroupId) return;
            const group = groups.find(g => g.id === currentGroupId);
            if (group) {
                document.getElementById('editGroupNameInput').value = group.name;
                document.getElementById('editGroupIconInput').value = group.icon;
                editGroupModal.classList.remove('hidden');
            }
        });
    }

    closeEditGroupModalBtn.addEventListener('click', () => editGroupModal.classList.add('hidden'));
    cancelEditGroupBtn.addEventListener('click', () => editGroupModal.classList.add('hidden'));

    confirmEditGroupBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('editGroupNameInput');
        const iconInput = document.getElementById('editGroupIconInput');
        const name = nameInput.value.trim();
        const icon = iconInput.value.trim().charAt(0).toUpperCase();

        if(!name) return alert('Пожалуйста, введите название группы');
        if(!currentGroupId) return;

        await editGroup(currentGroupId, name, icon);
        editGroupModal.classList.add('hidden');
    });

    deleteGroupBtn.addEventListener('click', async () => {
        if (!currentGroupId) return;
        if (confirm('Вы уверены, что хотите удалить эту группу? Это действие необратимо.')) {
            await deleteGroup(currentGroupId);
            editGroupModal.classList.add('hidden');
        }
    });
}

async function populateFriendSelection() {
    const list = document.getElementById('friendSelectionList');
    list.innerHTML = 'Загрузка друзей...';
    
    try {
        const response = await fetch('/api/friends', {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await response.json();
        list.innerHTML = '';
        
        if(friends.length === 0) {
            list.innerHTML = '<div>Нет друзей для приглашения</div>';
            return;
        }

        friends.forEach(friend => {
            const item = document.createElement('div');
            item.className = 'friend-select-item';
            item.dataset.id = friend.id;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', 'false');

            const avatarImg = friend.avatar && friend.avatar.startsWith('/uploads/') 
                ? `<img src="${friend.avatar}" alt="Аватар ${friend.username}" class="friend-avatar-img friend-select-avatar">`
                : `<div class="friend-avatar friend-select-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>`;

            item.innerHTML = `
                ${avatarImg}
                <div class="checkbox"></div>
                <span>${friend.username}</span>
            `;
            item.addEventListener('click', () => {
                const isSelected = item.classList.toggle('selected');
                item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            });
            list.appendChild(item);
        });

    } catch(e) {
        console.error(e);
        list.innerHTML = 'Ошибка загрузки друзей';
    }
}

async function createGroup(name, memberIds) {
    try {
        const response = await fetch('/api/groups', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, members: memberIds })
        });

        if(response.ok) {
            loadUserGroups(); // Refresh list
        } else {
            alert('Не удалось создать группу');
        }
    } catch(e) {
        console.error(e);
    }
}

async function editGroup(groupId, name, icon) {
    try {
        const response = await fetch(`/api/groups/${groupId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, icon })
        });

        if(response.ok) {
            loadUserGroups(); // Refresh list
            alert('Группа успешно обновлена!');
            const updatedGroup = { ...groups.find(g => g.id === groupId), name, icon };
            startGroupChat(updatedGroup); // Refresh chat header
        } else {
            alert('Не удалось обновить группу');
        }
    } catch(e) {
        console.error(e);
    }
}

async function deleteGroup(groupId) {
    try {
        const response = await fetch(`/api/groups/${groupId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if(response.ok) {
            loadUserGroups(); // Refresh list
            showFriendsView(); // Go back to friends view after deleting group
            alert('Группа успешно удалена!');
        } else {
            alert('Не удалось удалить группу');
        }
    } catch(e) {
        console.error(e);
    }
}

async function loadUserGroups() {
    try {
        const response = await fetch('/api/groups', {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const groupsData = await response.json();
        groups = groupsData;
        
        // Refresh DM list (where groups live)
        // We need to re-fetch friends to merge list, simplified for now:
        const friendsResp = await fetch('/api/friends', {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await friendsResp.json();
        populateDMList(friends);

    } catch(e) {
        console.error(e);
    }
}

// Update populateDMList to include groups
function populateDMList(friends) {
   const dmList = document.getElementById('dmList');
   dmList.innerHTML = '';

   // Add Groups first
   if(groups && groups.length > 0) {
       const groupHeader = document.createElement('div');
       groupHeader.style.padding = '8px 20px 4px 20px';
       groupHeader.style.fontSize = '11px';
       groupHeader.style.color = '#8e9297';
       groupHeader.innerText = 'ГРУППЫ';
       dmList.appendChild(groupHeader);

       groups.forEach(group => {
           const item = document.createElement('div');
           item.className = 'channel';
           item.setAttribute('data-group-id', group.id);
           item.setAttribute('role', 'listitem');
           item.setAttribute('aria-label', `Группа ${group.name}`);

           const groupIconContent = group.icon && group.icon.startsWith('/uploads/')
                ? `<img src="${group.icon}" alt="Иконка группы ${group.name}" class="group-avatar-img">`
                : `<div class="group-avatar">${group.icon || group.name.charAt(0).toUpperCase()}</div>`;

           item.innerHTML = `
               ${groupIconContent}
               <span>${group.name} (${group.member_count})</span>
           `;
           item.addEventListener('click', () => startGroupChat(group));
           dmList.appendChild(item);
       });
   }

   // Add Friends
   const friendHeader = document.createElement('div');
   friendHeader.style.padding = '8px 20px 4px 20px';
   friendHeader.style.fontSize = '11px';
   friendHeader.style.color = '#8e9297';
   friendHeader.innerText = 'ДРУЗЬЯ';
   dmList.appendChild(friendHeader);

   if (friends.length === 0) {
       const emptyDM = document.createElement('div');
       emptyDM.className = 'empty-dm-list';
       emptyDM.textContent = 'Разговоров пока нет.';
       dmList.appendChild(emptyDM);
       return;
   }

   friends.forEach(friend => {
       const dmItem = document.createElement('div');
       dmItem.className = 'channel';
       dmItem.setAttribute('data-dm-id', friend.id);
       dmItem.setAttribute('role', 'listitem');
       dmItem.setAttribute('aria-label', `Чат с ${friend.username}`);

       const avatarImg = friend.avatar && friend.avatar.startsWith('/uploads/') 
            ? `<img src="${friend.avatar}" alt="Аватар ${friend.username}" class="friend-avatar-img">`
            : `<div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>`;

       dmItem.innerHTML = `
           ${avatarImg}
           <span>${friend.username}</span>
       `;
       dmItem.addEventListener('click', () => {
           startDM(friend.id, friend.username, friend.avatar);
       });
       dmList.appendChild(dmItem);
   });
}

function initializeChatTabs() {
    const chatTabs = document.querySelectorAll('.chat-tab');
    chatTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-chat-tab');
            switchChatTab(tabName);
        });
    });
}

function switchChatTab(tabName) {
    activeChatTab = tabName;

    document.querySelectorAll('.chat-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
        t.setAttribute('tabindex', '-1');
    });
    const activeTabButton = document.querySelector(`[data-chat-tab="${tabName}"]`);
    activeTabButton.classList.add('active');
    activeTabButton.setAttribute('aria-selected', 'true');
    activeTabButton.setAttribute('tabindex', '0');

    const messagesContainer = document.getElementById('messagesContainer');
    const participantsListView = document.getElementById('participantsListView');
    const messageInputContainer = document.getElementById('messageInputContainer');

    if (tabName === 'chat') {
        messagesContainer.style.display = 'flex';
        messagesContainer.removeAttribute('hidden');
        participantsListView.style.display = 'none';
        participantsListView.setAttribute('hidden', 'true');
        messageInputContainer.style.display = 'block';
        messageInputContainer.removeAttribute('hidden');
        scrollToBottom();
    } else { // participants tab
        messagesContainer.style.display = 'none';
        messagesContainer.setAttribute('hidden', 'true');
        participantsListView.style.display = 'block';
        participantsListView.removeAttribute('hidden');
        messageInputContainer.style.display = 'none';
        messageInputContainer.setAttribute('hidden', 'true');
        if (currentGroupId) {
            loadGroupMembers(currentGroupId);
        }
    }
}

async function startGroupChat(group) {
    currentView = 'group';
    currentGroupId = group.id;
    currentDMUserId = null;
    currentServerId = null;
    activeChatTab = 'chat'; // Reset to chat tab

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    const groupIconContent = group.icon && group.icon.startsWith('/uploads/')
        ? `<img src="${group.icon}" alt="Иконка группы ${group.name}" class="group-chat-avatar-img">`
        : `<div class="group-chat-avatar">${group.icon || group.name.charAt(0).toUpperCase()}</div>`;

    chatHeaderInfo.innerHTML = `
        ${groupIconContent}
        <span class="channel-name">${group.name}</span>
    `;
    
    // Show Group Call Button and Group Settings Button
    const groupCallBtn = document.getElementById('groupCallBtn');
    const groupSettingsBtn = document.getElementById('groupSettingsBtn');

    groupCallBtn.style.display = 'flex';
    groupCallBtn.onclick = () => joinGroupCall(group.id, group.name);
    
    // Only show group settings if current user is owner
    if (currentUser && group.owner_id === currentUser.id) {
        groupSettingsBtn.style.display = 'flex';
    } else {
        groupSettingsBtn.style.display = 'none';
    }

    // Show chat tabs
    document.getElementById('chatTabs').style.display = 'flex';
    switchChatTab('chat'); // Activate chat tab by default
    
    document.getElementById('messageInput').placeholder = `Сообщение ${group.name}`;
    
    await loadGroupHistory(group.id);
}

async function loadGroupHistory(groupId) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';
    
    try {
        const res = await fetch(`/api/groups/${groupId}/messages`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const msgs = await res.json();
        msgs.forEach(message => {
             addMessageToUI({
                   id: message.id,
                   author: message.username,
                   avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                   text: message.content,
                   timestamp: message.created_at
             });
        });
        scrollToBottom();
    } catch(e) { console.error(e); }
}

async function loadGroupMembers(groupId) {
    const participantsListView = document.getElementById('participantsListView');
    participantsListView.innerHTML = '<div class="friends-empty">Загрузка участников...</div>';

    try {
        const response = await fetch(`/api/groups/${groupId}/members`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const members = await response.json();
        participantsListView.innerHTML = '';

        if (members.length === 0) {
            participantsListView.innerHTML = '<div class="friends-empty">В этой группе нет участников.</div>';
            return;
        }

        members.forEach(member => {
            const memberDiv = document.createElement('div');
            memberDiv.className = 'friend-item'; // Re-use friend-item styling for simplicity
            memberDiv.setAttribute('role', 'listitem');

            const avatarImg = member.avatar && member.avatar.startsWith('/uploads/') 
                ? `<img src="${member.avatar}" alt="Аватар ${member.username}" class="friend-avatar-img">`
                : `<div class="friend-avatar">${member.avatar || member.username.charAt(0).toUpperCase()}</div>`;

            memberDiv.innerHTML = `
                ${avatarImg}
                <div class="friend-info">
                    <div class="friend-name">${member.username}</div>
                    <div class="friend-status ${member.status === 'Online' ? '' : 'offline'}">${member.status}</div>
                </div>
            `;
            participantsListView.appendChild(memberDiv);
        });

    } catch (e) {
        console.error('Error loading group members:', e);
        participantsListView.innerHTML = '<div class="friends-empty">Ошибка загрузки участников группы.</div>';
    }
}

async function joinGroupCall(groupId, groupName) {
     if (inCall) {
        document.getElementById('callInterface').classList.remove('hidden');
        return;
    }
    
    inCall = true;
    const callInterface = document.getElementById('callInterface');
    callInterface.classList.remove('hidden');
    document.querySelector('.call-channel-name').textContent = `Групповой звонок: ${groupName}`;

    try {
        await initializeMedia('video'); // Default to video for group calls
        
        // Connect to the socket for voice
        if (socket && socket.connected) {
            socket.emit('initiate-group-call', { 
                groupId: groupId, 
                callerInfo: { 
                    id: currentUser.id, 
                    username: currentUser.username, 
                    socketId: socket.id, 
                    avatar: currentUser.avatar 
                },
                type: isVideoEnabled ? 'video' : 'audio'
            });
        }
        isAudioEnabled = true; // Ensure audio is on by default for group calls
        updateCallButtons(); // Update button state to reflect camera off, audio on.
    } catch (e) {
        console.error(e);
        leaveVoiceChannel(true);
    }
}


// Initiate call function
async function initiateCall(friendId, friendUsername, type, friendAvatar) {
    if (inCall) {
        alert('Вы уже в другом звонке.');
        return;
    }
    try {
        await initializeMedia(type); // Pass type to initializeMedia to set initial video state
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        
        // Update call header
        document.querySelector('.call-channel-name').textContent = `Вызов: ${friendUsername}...`;
        
        // Set local video
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Initialize Zoom for local video
        initializeZoom(localVideo.parentElement, localVideo);

        // Store call details
        window.currentCallDetails = {
            friendId: friendId,
            type: type,
            isInitiator: true,
            originalType: type,
            friendUsername: friendUsername,
            friendAvatar: friendAvatar
        };
        
        // Emit call request via socket
        if (socket && socket.connected) {
            socket.emit('initiate-call', {
                to: friendId,
                type: type,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id,
                    avatar: currentUser.avatar
                }
            });
        }
        
        inCall = true;
        isAudioEnabled = true;
        updateCallButtons();
        playRingingSound(); // Start ringing sound for outgoing call
        
    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Не удалось получить доступ к камере/микрофону. Проверьте разрешения.');
        stopRingingSound();
    }
}

// Show incoming call notification
function showIncomingCall(caller, type, groupId = null) {
    playRingingSound(); // Start ringing sound for incoming call

    const incomingCallDiv = document.getElementById('incomingCall');
    const callerNameEl = incomingCallDiv.querySelector('.caller-name');
    const callerAvatarEl = incomingCallDiv.querySelector('.caller-avatar');
    const incomingCallMessage = document.getElementById('incomingCallMessage');
    
    callerNameEl.textContent = caller.username || 'Неизвестный пользователь';
    
    if (caller.avatar && caller.avatar.startsWith('/uploads/')) {
        callerAvatarEl.style.backgroundImage = `url('${caller.avatar}')`;
        callerAvatarEl.style.backgroundSize = 'cover';
        callerAvatarEl.textContent = '';
    } else {
        callerAvatarEl.style.backgroundImage = 'none';
        callerAvatarEl.textContent = caller.avatar || caller.username?.charAt(0).toUpperCase() || 'U';
    }

    const callTypeMessage = type === 'video' ? 'видеозвонок' : 'аудиозвонок';
    incomingCallMessage.textContent = `звонит вам с ${callTypeMessage}...`;
    
    incomingCallDiv.classList.remove('hidden');
    
    // Set up accept/reject handlers
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    
    acceptBtn.onclick = async () => {
        incomingCallDiv.classList.add('hidden');
        stopRingingSound();
        await acceptCall(caller, type, groupId);
    };
    
    rejectBtn.onclick = () => {
        incomingCallDiv.classList.add('hidden');
        stopRingingSound();
        rejectCall(caller, groupId);
    };
    
    // Auto-reject after 30 seconds
    setTimeout(() => {
        if (!incomingCallDiv.classList.contains('hidden')) {
            incomingCallDiv.classList.add('hidden');
            stopRingingSound();
            rejectCall(caller, groupId, 'Пропущенный звонок');
        }
    }, 30000);
}

// Accept incoming call
async function acceptCall(caller, type, groupId = null) {
    try {
        await initializeMedia(type);
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        
        document.querySelector('.call-channel-name').textContent = groupId ? `Групповой звонок: ${groups.find(g => g.id === groupId)?.name || 'Unknown Group'}` : `Звонок с ${caller.username}`;
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Initialize zoom for local video
        initializeZoom(localVideo.parentElement, localVideo);

        // Store call details
        window.currentCallDetails = {
            peerId: caller.socketId,
            type: type,
            isInitiator: false,
            originalType: type,
            groupId: groupId
        };
        
        if (socket && socket.connected) {
            if (groupId) {
                socket.emit('accept-group-call', {
                    groupId: groupId,
                    from: {
                        id: currentUser.id,
                        username: currentUser.username,
                        socketId: socket.id,
                        avatar: currentUser.avatar
                    }
                });
            } else {
                socket.emit('accept-call', {
                    to: caller.socketId,
                    from: {
                        id: currentUser.id,
                        username: currentUser.username,
                        socketId: socket.id,
                        avatar: currentUser.avatar
                    }
                });
            }
        }
        
        inCall = true;
        isAudioEnabled = true;
        updateCallButtons();
        
        // Create peer connection as receiver (not initiator)
        if (!peerConnections[caller.socketId]) {
            createPeerConnection(caller.socketId, false);
        }
        
    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Не удалось получить доступ к камере/микрофону. Проверьте разрешения.');
        stopRingingSound();
    }
}

// Reject incoming call
function rejectCall(caller, groupId = null, message = 'Звонок отклонен') {
    if (socket && socket.connected) {
        if (groupId) {
            socket.emit('reject-group-call', {
                groupId: groupId,
                to: caller.socketId,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id,
                    avatar: currentUser.avatar
                },
                message: message
            });
        } else {
            socket.emit('reject-call', { to: caller.socketId, message: message });
        }
    }
    stopRingingSound();
}

window.startDM = async function(friendId, friendUsername, friendAvatar) {
    currentView = 'dm';
    currentDMUserId = friendId;
    currentServerId = null;
    currentGroupId = null;
    activeChatTab = 'chat'; // Reset to chat tab

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    const avatarImg = friendAvatar && friendAvatar.startsWith('/uploads/') 
        ? `<img src="${friendAvatar}" alt="Аватар ${friendUsername}" class="friend-chat-avatar-img">`
        : `<div class="friend-chat-avatar">${friendAvatar || friendUsername.charAt(0).toUpperCase()}</div>`;

    chatHeaderInfo.innerHTML = `
        ${avatarImg}
        <span class="channel-name">${friendUsername}</span>
    `;
    
    // Hide Group Call Button and Group Settings Button for DMs
    document.getElementById('groupCallBtn').style.display = 'none';
    document.getElementById('groupSettingsBtn').style.display = 'none';
    document.getElementById('chatTabs').style.display = 'none'; // Hide chat tabs for DMs

    document.getElementById('messageInput').placeholder = `Сообщение @${friendUsername}`;
    
    await loadDMHistory(friendId);
};

// Show friends view
function showFriendsView() {
    currentView = 'friends';
    currentDMUserId = null;
    currentServerId = null;
    currentGroupId = null;
    activeChatTab = 'chat';

    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';
    
    document.getElementById('serverName').textContent = 'Друзья';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
    
    // Hide chat related elements when in friends view
    document.getElementById('chatTabs').style.display = 'none';
    document.getElementById('groupCallBtn').style.display = 'none';
    document.getElementById('groupSettingsBtn').style.display = 'none';

    // Ensure only friends lists are active
    switchFriendsTab(document.querySelector('.friends-tab.active')?.dataset.tab || 'online');
}

// Show server view
function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentDMUserId = null;
    currentGroupId = null;
    activeChatTab = 'chat';

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'block';
    document.getElementById('dmListView').style.display = 'none';

    document.getElementById('serverName').textContent = server.name;

    // Hide Group Call Button and Group Settings Button for servers
    document.getElementById('groupCallBtn').style.display = 'none';
    document.getElementById('groupSettingsBtn').style.display = 'none';
    document.getElementById('chatTabs').style.display = 'none'; // Hide chat tabs for servers

    switchChannel('general');
}

async function loadUserServers() {
    try {
        const response = await fetch('/api/servers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        servers = await response.json();
        servers.forEach(server => addServerToUI(server, false));
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

function initializeServerManagement() {
    const friendsBtn = document.getElementById('friendsBtn');
    // const addServerBtn = document.getElementById('addServerBtn'); // Removed as per request
    
    friendsBtn.addEventListener('click', () => {
        showFriendsView();
    });
    
    // addServerBtn.addEventListener('click', () => { // Removed as per request
    //     createNewServer();
    // });
}

// createNewServer function is no longer accessible from UI as per request.
/* async function createNewServer() {
    const serverName = prompt('Введите название сервера:');
    
    if (!serverName || serverName.trim() === '') return;
    
    try {
        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: serverName.trim() })
        });
        
        if (response.ok) {
            const server = await response.json();
            servers.push(server);
            addServerToUI(server, true);
        }
    } catch (error) {
        console.error('Error creating server:', error);
        alert('Не удалось создать сервер');
    }
} */

function addServerToUI(server, switchTo = false) {
    const serverList = document.querySelector('.server-list');
    const serverSeparator = document.querySelector('.server-separator'); // Find the separator
    
    const serverIcon = document.createElement('div');
    serverIcon.className = 'server-icon';
    serverIcon.textContent = server.icon;
    serverIcon.title = server.name;
    serverIcon.setAttribute('data-server-id', server.id);
    serverIcon.setAttribute('role', 'button');
    serverIcon.setAttribute('aria-label', `Перейти на сервер ${server.name}`);
    
    serverIcon.addEventListener('click', () => {
        document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
        serverIcon.classList.add('active'); // Add active class to the clicked server icon
        showServerView(server);
    });
    
    // Insert before the separator or at the end if no separator
    if (serverSeparator) {
        serverList.insertBefore(serverIcon, serverSeparator.nextSibling);
    } else {
        serverList.appendChild(serverIcon);
    }
    
    if (switchTo) {
        serverIcon.click();
    }
}

function initializeChannels() {
    const channelElements = document.querySelectorAll('.channel');
    
    channelElements.forEach(channel => {
        channel.addEventListener('click', () => {
            // Remove active from all channels
            document.querySelectorAll('.channel').forEach(ch => ch.classList.remove('active'));
            // Add active to the clicked channel
            channel.classList.add('active');

            const channelName = channel.getAttribute('data-channel');
            const isVoiceChannel = channel.classList.contains('voice-channel');
            
            if (isVoiceChannel) {
                joinVoiceChannel(channelName);
            } else {
                switchChannel(channelName);
            }
        });
    });
}

function switchChannel(channelName) {
    currentChannel = channelName;
    
    document.querySelectorAll('.text-channel').forEach(ch => ch.classList.remove('active'));
    const channelEl = document.querySelector(`.text-channel[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('active');
    
    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39677 3.41262C8.43914 3.17391 8.64664 3 8.88907 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3968 3.41262C16.4391 3.17391 16.6466 3 16.8891 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3632 20.5874C15.3209 20.8261 15.1134 21 14.8709 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36325 20.5874C7.32088 20.8261 7.11337 21 6.87094 21H5.88657ZM9.41045 9L8.35045 15H14.3504L15.4104 9H9.41045Z"/></svg>
        <span class="channel-name">${channelName}</span>
    `;

    document.getElementById('messageInput').placeholder = `Сообщение #${channelName}`;
    
    loadChannelMessages(channelName);
}

async function loadChannelMessages(channelName) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';

    const channelId = getChannelIdByName(channelName);

    try {
        const response = await fetch(`/api/messages/${channelId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const messages = await response.json();
            messages.forEach(message => {
                addMessageToUI({
                    id: message.id,
                    author: message.username,
                    avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                    text: message.content,
                    timestamp: message.created_at
                });
            });
        } else {
            console.error('Failed to load messages');
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }

    scrollToBottom();
}

function initializeMessageInput() {
    const messageInput = document.getElementById('messageInput');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const text = messageInput.value.trim();
    
    if (text === '') return;

    const message = {
        text: text,
    };

    if (socket && socket.connected) {
        if (currentView === 'dm' && currentDMUserId) {
            socket.emit('send-dm', {
                receiverId: currentDMUserId,
                message: message
            });
        } else if (currentView === 'group' && currentGroupId) {
             socket.emit('send-group-message', {
                groupId: currentGroupId,
                message: message
            });
        } else if (currentView === 'server') {
            const channelId = getChannelIdByName(currentChannel);
            socket.emit('send-message', {
                channelId: channelId,
                message: message
            });
        }
    }
    
    messageInput.value = '';
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group';
    messageGroup.setAttribute('data-message-id', message.id || Date.now());
    messageGroup.setAttribute('role', 'listitem');
    messageGroup.setAttribute('aria-label', `Сообщение от ${message.author}`);
    
    const avatarContent = message.avatar && message.avatar.startsWith('/uploads/') 
        ? `<img src="${message.avatar}" alt="Аватар ${message.author}" class="message-avatar-img">`
        : `<div class="message-avatar">${message.avatar || message.author.charAt(0).toUpperCase()}</div>`;

    const fileContent = message.file ? 
        `<div class="message-file">
            <a href="${message.file.url}" target="_blank" rel="noopener noreferrer" aria-label="Скачать файл ${message.file.filename}">
                📎 ${message.file.filename} (${formatBytes(message.file.size)})
            </a>
        </div>` : '';

    messageGroup.innerHTML = `
        ${avatarContent}
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${message.author}</span>
                <span class="message-timestamp">${formatTimestamp(message.timestamp)}</span>
            </div>
            <div class="message-text">${message.text}</div>
            ${fileContent}
            <div class="message-reactions" role="group" aria-label="Реакции на сообщение"></div>
            <button class="add-reaction-btn" title="Добавить реакцию" aria-label="Добавить реакцию на сообщение">😊</button>
        </div>
    `;

    const addReactionBtn = messageGroup.querySelector('.add-reaction-btn');
    if (addReactionBtn) {
        addReactionBtn.onclick = (e) => showEmojiPickerForMessage(message.id || Date.now(), e);
    }
    
    messagesContainer.appendChild(messageGroup);
}

function formatTimestamp(date) {
    const messageDate = new Date(date);
    const hours = messageDate.getHours().toString().padStart(2, '0');
    const minutes = messageDate.getMinutes().toString().padStart(2, '0');
    return `Сегодня в ${hours}:${minutes}`;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Emoji picker
function initializeEmojiPicker() {
    const emojiBtn = document.querySelector('.emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            showEmojiPicker(e, (emoji) => {
                const input = document.getElementById('messageInput');
                input.value += emoji;
                input.focus();
            });
        });
    }
}

function showEmojiPickerForMessage(messageId, event) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
    showEmojiPicker(event, (emoji) => {
        addReaction(messageId, emoji);
    }, emojis);
}

function showEmojiPicker(event, onSelect, customEmojis = null) {
    const existingPicker = document.querySelector('.emoji-picker');
    if (existingPicker) existingPicker.remove();

    const emojis = customEmojis || ['😀', '😂', '❤️', '👍', '👎', '🎉', '🔥', '✨', '💯', '🚀', '🥳', '😎', '🤩', '🤔', '🙏', '🤯'];
    
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.setAttribute('role', 'listbox');
    picker.setAttribute('aria-label', 'Выберите эмодзи');
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = emoji;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-label', emoji);
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent document click from closing immediately
            onSelect(emoji);
            picker.remove();
        });
        picker.appendChild(btn);
    });
    
    document.body.appendChild(picker);

    // Position the picker near the event target
    const rect = event.target.getBoundingClientRect();
    picker.style.top = `${rect.top - picker.offsetHeight - 10}px`; // Above the button
    picker.style.left = `${rect.left + rect.width / 2 - picker.offsetWidth / 2}px`;

    // Adjust if it goes off screen
    if (parseFloat(picker.style.top) < 0) {
        picker.style.top = `${rect.bottom + 10}px`;
    }
    if (parseFloat(picker.style.left) < 0) {
        picker.style.left = '10px';
    }
    if (parseFloat(picker.style.left) + picker.offsetWidth > window.innerWidth) {
        picker.style.left = `${window.innerWidth - picker.offsetWidth - 10}px`;
    }

    setTimeout(() => {
        document.addEventListener('click', function closePickerAnywhere(e) {
            if (!picker.contains(e.target) && !event.target.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePickerAnywhere);
            }
        }, { once: true });
    }, 0);
    
    // Ensure picker is always visible
    picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


function addReaction(messageId, emoji) {
    if (socket && socket.connected) {
        socket.emit('add-reaction', { messageId, emoji });
    }
}

function updateMessageReactions(messageId, reactions) {
    const messageGroup = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageGroup) return;

    const reactionsContainer = messageGroup.querySelector('.message-reactions');
    if (!reactionsContainer) return;
    
    reactionsContainer.innerHTML = '';
    
    reactions.forEach(reaction => {
        const reactionEl = document.createElement('button');
        reactionEl.className = 'reaction';
        reactionEl.innerHTML = `${reaction.emoji} <span>${reaction.count}</span>`;
        reactionEl.title = `Реагировали: ${reaction.users}`;
        reactionEl.setAttribute('aria-label', `Удалить реакцию ${reaction.emoji}. Текущее количество: ${reaction.count}.`);
        reactionEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (socket && socket.connected) {
                socket.emit('remove-reaction', { messageId, emoji: reaction.emoji });
            }
        });
        reactionsContainer.appendChild(reactionEl);
    });
}

// File upload
function initializeFileUpload() {
    const attachBtn = document.querySelector('.attach-btn');
    const messageInputContainer = document.getElementById('messageInputContainer');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true; // Allow multiple files
    fileInput.style.display = 'none';
    fileInput.setAttribute('aria-label', 'Загрузить файл');
    document.body.appendChild(fileInput);
    
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            for (const file of files) {
                await uploadFile(file);
            }
        }
        fileInput.value = ''; // Clear selected files
    });

    // Drag & Drop
    messageInputContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        messageInputContainer.classList.add('drag-over');
    });

    messageInputContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        messageInputContainer.classList.remove('drag-over');
    });

    messageInputContainer.addEventListener('drop', async (e) => {
        e.preventDefault();
        messageInputContainer.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            for (const file of files) {
                await uploadFile(file);
            }
        }
    });
}

async function uploadFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        let targetId;
        if (currentView === 'dm' && currentDMUserId) {
            targetId = currentDMUserId;
            formData.append('dmReceiverId', currentDMUserId); // For DM file uploads
        } else if (currentView === 'group' && currentGroupId) {
            targetId = currentGroupId;
            formData.append('groupId', currentGroupId); // For group file uploads
        } else if (currentView === 'server') {
            targetId = getChannelIdByName(currentChannel);
            formData.append('channelId', targetId);
        } else {
            alert('Не удалось определить, куда загружать файл.');
            return;
        }

        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Загрузка не удалась');
        }
        
        const fileData = await response.json();
        
        const message = {
            author: currentUser.username,
            avatar: currentUser.avatar,
            text: `Загружено: ${file.name} (${formatBytes(file.size)})`,
            file: {
                filename: file.name,
                url: fileData.url,
                type: file.type,
                size: fileData.size // Add size to message file object
            },
            timestamp: new Date()
        };

        // Add to UI immediately
        addMessageToUI(message);
        scrollToBottom();

        // Emit socket event for real-time update
        if (socket && socket.connected) {
            if (currentView === 'dm' && currentDMUserId) {
                 socket.emit('send-dm', {
                    receiverId: currentDMUserId,
                    message: message // Send entire message object including file info
                });
            } else if (currentView === 'group' && currentGroupId) {
                 socket.emit('send-group-message', {
                    groupId: currentGroupId,
                    message: message // Send entire message object including file info
                });
            } else if (currentView === 'server' && targetId) {
                socket.emit('send-message', {
                    channelId: targetId,
                    message: message // Send entire message object including file info
                });
            }
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Не удалось загрузить файл');
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


// User controls
function initializeUserControls() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const profileSettingsModal = document.getElementById('profileSettingsModal');
    const closeProfileSettingsModalBtn = profileSettingsModal.querySelector('.close-modal-btn');
    const cancelProfileSettingsBtn = profileSettingsModal.querySelector('.cancel-btn');
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    const profileAvatarInput = document.getElementById('profileAvatarInput');

    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.querySelector('.icon-normal').style.display = isMuted ? 'none' : 'block';
        muteBtn.querySelector('.icon-slashed').style.display = isMuted ? 'block' : 'none';
        
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
        muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
    });
    
    deafenBtn.addEventListener('click', () => {
        isDeafened = !isDeafened;
        deafenBtn.querySelector('.icon-normal').style.display = isDeafened ? 'none' : 'block';
        deafenBtn.querySelector('.icon-slashed').style.display = isDeafened ? 'block' : 'none';
        
        // When deafened, also mute microphone
        if (isDeafened) {
            if (!isMuted) {
                isMuted = true;
                muteBtn.querySelector('.icon-normal').style.display = 'none';
                muteBtn.querySelector('.icon-slashed').style.display = 'block';
                if (localStream) {
                    localStream.getAudioTracks().forEach(track => {
                        track.enabled = false;
                    });
                }
            }
            
            // Mute all remote audio
            document.querySelectorAll('video[id^="remote-"]').forEach(video => {
                video.volume = 0;
            });
        } else {
            // Unmute remote audio (only if not locally muted)
            if (!isMuted) {
                document.querySelectorAll('video[id^="remote-"]').forEach(video => {
                    video.volume = 1;
                });
            }
        }

        // Update local stream audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted; // Reflect mute state
            });
        }
        deafenBtn.setAttribute('aria-pressed', isDeafened ? 'true' : 'false');
    });
    
    settingsBtn.addEventListener('click', () => {
        openProfileSettingsModal();
    });

    closeProfileSettingsModalBtn.addEventListener('click', () => profileSettingsModal.classList.add('hidden'));
    cancelProfileSettingsBtn.addEventListener('click', () => profileSettingsModal.classList.add('hidden'));
    saveProfileBtn.addEventListener('click', saveProfileChanges);

    profileAvatarInput.addEventListener('change', handleAvatarUploadPreview);
}

function openProfileSettingsModal() {
    const profileSettingsModal = document.getElementById('profileSettingsModal');
    profileSettingsModal.classList.remove('hidden');
    // Ensure current user info is loaded into the form fields
    updateUserInfo();
}

async function handleAvatarUploadPreview(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const profileAvatarPreview = document.getElementById('profileAvatarPreview');
            profileAvatarPreview.src = e.target.result;
            profileAvatarPreview.alt = "Новый аватар";
        };
        reader.readAsDataURL(file);
    }
}

async function saveProfileChanges() {
    const profileUsernameInput = document.getElementById('profileUsernameInput');
    const profileAvatarInput = document.getElementById('profileAvatarInput');
    const newUsername = profileUsernameInput.value.trim();
    const newAvatarFile = profileAvatarInput.files[0];

    if (!newUsername) {
        alert('Имя пользователя не может быть пустым.');
        return;
    }

    // Update username
    if (newUsername !== currentUser.username) {
        try {
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: newUsername })
            });
            if (response.ok) {
                currentUser.username = newUsername;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateUserInfo();
            } else {
                const errorData = await response.json();
                alert(`Не удалось обновить имя пользователя: ${errorData.error}`);
            }
        } catch (error) {
            console.error('Error updating username:', error);
            alert('Ошибка сети при обновлении имени пользователя.');
        }
    }

    // Update avatar
    if (newAvatarFile) {
        try {
            const formData = new FormData();
            formData.append('avatar', newAvatarFile);
            
            const response = await fetch('/api/user/avatar', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                currentUser.avatar = data.avatarUrl;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateUserInfo();
            } else {
                const errorData = await response.json();
                alert(`Не удалось загрузить аватар: ${errorData.error}`);
            }
        } catch (error) {
            console.error('Error uploading avatar:', error);
            alert('Ошибка сети при загрузке аватара.');
        }
    }

    document.getElementById('profileSettingsModal').classList.add('hidden');
}


// Voice channel functions - call persists when switching views
async function joinVoiceChannel(channelName) {
    if (inCall) {
        const callInterface = document.getElementById('callInterface');
        if (callInterface.classList.contains('hidden')) {
            callInterface.classList.remove('hidden');
        }
        return;
    }
    
    inCall = true;
    
    document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('in-call');
    
    const callInterface = document.getElementById('callInterface');
    callInterface.classList.remove('hidden');
    
    document.querySelector('.call-channel-name').textContent = channelName;
    
    try {
        await initializeMedia('video'); // Default to video for voice channels
        
        // Connect to the socket for voice
        if (socket && socket.connected) {
            socket.emit('join-voice-channel', { channelName, userId: currentUser.id, username: currentUser.username, avatar: currentUser.avatar });
        }
        usersInVoiceCall.set(socket.id, { userId: currentUser.id, username: currentUser.username, avatar: currentUser.avatar }); // Add self to list
        updateCallParticipantsLayout();

    } catch (error) {
        console.error('Error initializing media:', error);
        alert('Ошибка доступа к камере/микрофону. Предоставьте разрешения.');
        leaveVoiceChannel(true); // Force leave
    }
}

async function initializeMedia(callType) {
    try {
        // Better audio constraints for clear voice
        const constraints = {
            video: callType === 'video' ? {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } : false, // No video for audio-only calls
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                sampleSize: 16,
                channelCount: 1
            }
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Camera off by default for new calls, unless explicitly video call type
        if (callType === 'video') {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = true; // Enable video if it's a video call
            });
            isVideoEnabled = true;
        } else {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = false;
            });
            isVideoEnabled = false; // Set state to reflect camera is off
        }
        
        updateCallButtons(); // Update button state

        // Initialize Zoom for local video (optional, usually you don't zoom yourself, but consistent UI)
        initializeZoom(localVideo.parentElement, localVideo);

        if (isMuted || isDeafened) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
    } catch (error) {
        console.error('Error getting media devices:', error);
        throw error;
    }
}

function leaveVoiceChannel(force = false) {
    if (!inCall) return;

    if (force) {
        inCall = false;
        stopRingingSound();
        stopPingInterval();
        usersInVoiceCall.clear();

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        if (socket && socket.connected) {
             if(currentView === 'group' && currentGroupId) {
                 socket.emit('leave-group-voice', { groupId: currentGroupId });
             } else if (window.currentCallDetails?.peerId) { // Direct call
                 socket.emit('end-call', { to: window.currentCallDetails.peerId });
             } else { // Server voice channel
                 socket.emit('leave-voice-channel', currentChannel);
             }
        }

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        zoomStates.clear(); // Clear all zoom states

        document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
        document.getElementById('remoteParticipants').innerHTML = '';
        document.getElementById('callInterface').classList.remove('fullscreen'); // Exit fullscreen if active
    }

    const callInterface = document.getElementById('callInterface');
    callInterface.classList.add('hidden');

    if (force) {
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = null;
        // Reset Zoom for local video
        if(localVideo.parentElement) {
            resetZoom(localVideo.parentElement, localVideo);
        }
        // Reset state for new call
        isVideoEnabled = false; // Camera off by default
        isAudioEnabled = true;
        updateCallButtons();
    }
    window.currentCallDetails = null; // Clear call details
    updateCallParticipantsLayout(); // Update layout as participants clear
}

function initializeCallControls() {
    const closeCallBtn = document.getElementById('closeCallBtn');
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    closeCallBtn.addEventListener('click', () => {
        // End call for both voice channels and direct calls
        leaveVoiceChannel(true); // Force leave on button click
    });
    
    toggleVideoBtn.addEventListener('click', () => {
        toggleVideo();
    });
    
    toggleAudioBtn.addEventListener('click', () => {
        toggleAudio();
    });
    
    toggleScreenBtn.addEventListener('click', () => {
        toggleScreenShare();
    });
}

function toggleVideo() {
    if (!localStream) return;
    
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoEnabled;
    });
    
    // Notify peer about video state change
    Object.keys(peerConnections).forEach(socketId => {
        if (socket && socket.connected) {
            socket.emit('video-toggle', {
                to: socketId,
                enabled: isVideoEnabled
            });
        }
    });
    
    updateCallButtons();
}

function toggleAudio() {
    if (!localStream) return;
    
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    
    // User-facing mute button state is handled separately in user-panel
    // This toggle is for the call itself
    
    updateCallButtons();
}

async function toggleScreenShare() {
    if (screenStream) {
        // Stop screen sharing
        screenStream.getTracks().forEach(track => track.stop());
        
        // Replace screen track with camera track in all peer connections
        const videoTrack = localStream.getVideoTracks()[0];
        Object.values(peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && videoTrack) {
                sender.replaceTrack(videoTrack);
            }
        });
        
        screenStream = null;
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        resetZoom(localVideo.parentElement, localVideo); // Reset zoom after stopping screen share
        
        updateCallButtons();
    } else {
        try {
            // Start screen sharing
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });
            
            const screenTrack = screenStream.getVideoTracks()[0];
            
            // Replace video track in all peer connections
            Object.values(peerConnections).forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack);
                }
            });
            
            // Show screen share in local video
            const localVideo = document.getElementById('localVideo');
            const mixedStream = new MediaStream([
                screenTrack,
                ...localStream.getAudioTracks()
            ]);
            localVideo.srcObject = mixedStream;
            resetZoom(localVideo.parentElement, localVideo); // Reset zoom after starting screen share
            
            // Handle screen share ending
            screenTrack.addEventListener('ended', () => {
                toggleScreenShare(); // This will stop screen sharing
            });
            
            updateCallButtons();
        } catch (error) {
            console.error('Error sharing screen:', error);
            if (error.name === 'NotAllowedError') {
                alert('Разрешение на демонстрацию экрана отклонено');
            } else {
                alert('Ошибка демонстрации экрана. Пожалуйста, попробуйте еще раз.');
            }
        }
    }
}

function updateCallButtons() {
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    if (toggleVideoBtn) {
        // Active means muted/off. So, if !isVideoEnabled, button should be active (red/different color)
        toggleVideoBtn.classList.toggle('active', !isVideoEnabled);
        toggleVideoBtn.setAttribute('aria-pressed', !isVideoEnabled ? 'true' : 'false');
    }
    
    if (toggleAudioBtn) {
        toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
        toggleAudioBtn.setAttribute('aria-pressed', !isAudioEnabled ? 'true' : 'false');
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('active', screenStream !== null);
        toggleScreenBtn.setAttribute('aria-pressed', screenStream !== null ? 'true' : 'false');
    }
}

function initializeDraggableCallWindow() {
   const callInterface = document.getElementById('callInterface');
   const callHeader = callInterface.querySelector('.call-header');
   let isDragging = false;
   let offsetX, offsetY;

   callHeader.addEventListener('mousedown', (e) => {
       if (callInterface.classList.contains('fullscreen')) return; // Disable drag in fullscreen
       isDragging = true;
       offsetX = e.clientX - callInterface.offsetLeft;
       offsetY = e.clientY - callInterface.offsetTop;
       callInterface.style.transition = 'none'; // Disable transition during drag
   });

   document.addEventListener('mousemove', (e) => {
       if (!isDragging) return;
       e.preventDefault();
       
       let newX = e.clientX - offsetX;
       let newY = e.clientY - offsetY;

       // Constrain within viewport
       const maxX = window.innerWidth - callInterface.offsetWidth;
       const maxY = window.innerHeight - callInterface.offsetHeight;

       newX = Math.max(0, Math.min(newX, maxX));
       newY = Math.max(0, Math.min(newY, maxY));

       callInterface.style.left = `${newX}px`;
       callInterface.style.top = `${newY}px`;
   });

   document.addEventListener('mouseup', () => {
       if (isDragging) {
           isDragging = false;
           callInterface.style.transition = 'all 0.3s ease'; // Re-enable transition
       }
   });
}

function getChannelIdByName(name) {
   // This is a temporary solution. A better approach would be to have a proper mapping.
   const channelElement = document.querySelector(`.text-channel[data-channel="${name}"]`);
   return channelElement ? parseInt(channelElement.dataset.channelId) : null;
}

function getChannelNameById(id) {
   // This is a temporary solution. A better approach would be to have a proper mapping.
   const channelElement = document.querySelector(`.text-channel[data-channel-id="${id}"]`);
   return channelElement ? channelElement.dataset.channel : null;
}

async function loadDMHistory(userId) {
   const messagesContainer = document.getElementById('messagesContainer');
   messagesContainer.innerHTML = '';

   try {
       const response = await fetch(`/api/dm/${userId}`, {
           headers: { 'Authorization': `Bearer ${token}` }
       });
       if (response.ok) {
           const messages = await response.json();
           messages.forEach(message => {
               addMessageToUI({
                   id: message.id,
                   author: message.username,
                   avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                   text: message.content,
                   timestamp: message.created_at,
                   file: message.file
               });
           });
       } else {
           console.error('Failed to load DM history');
       }
   } catch (error) {
       console.error('Error loading DM history:', error);
   }

   scrollToBottom();
}

console.log('Discord Clone initialized successfully!');
if (currentUser) {
   console.log('Logged in as:', currentUser.username);
}

// WebRTC Functions
function createPeerConnection(remoteSocketId, isInitiator) {
    console.log(`Creating peer connection with ${remoteSocketId}, initiator: ${isInitiator}`);
    
    if (peerConnections[remoteSocketId]) {
        return peerConnections[remoteSocketId];
    }
    
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    });

    peerConnections[remoteSocketId] = pc;

    // Add local stream tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                to: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle incoming remote stream
    pc.ontrack = (event) => {
        const remoteParticipants = document.getElementById('remoteParticipants');
        
        let participantDiv = document.getElementById(`participant-${remoteSocketId}`);
        let remoteVideo = document.getElementById(`remote-${remoteSocketId}`);
        let zoomContainer = null;

        if (!participantDiv) {
            participantDiv = document.createElement('div');
            participantDiv.className = 'participant';
            participantDiv.id = `participant-${remoteSocketId}`;
            participantDiv.setAttribute('role', 'listitem');
            
            // Zoom container wrapper
            zoomContainer = document.createElement('div');
            zoomContainer.className = 'zoom-container';

            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-${remoteSocketId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.volume = isDeafened ? 0 : 1;
            remoteVideo.setAttribute('aria-label', 'Видеопоток участника');
            
            const participantName = document.createElement('div');
            participantName.className = 'participant-name';
            // Find user from usersInVoiceCall map
            const user = usersInVoiceCall.get(remoteSocketId);
            participantName.textContent = user ? user.username : 'Участник'; 
            
            zoomContainer.appendChild(remoteVideo);
            participantDiv.appendChild(zoomContainer);
            participantDiv.appendChild(participantName);
            remoteParticipants.appendChild(participantDiv);

            // Initialize Pan/Zoom Logic
            initializeZoom(zoomContainer, remoteVideo);
            updateCallParticipantsLayout();
        }
        
        // Set the stream to the video element
        if (event.streams && event.streams[0]) {
            remoteVideo = document.getElementById(`remote-${remoteSocketId}`);
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];
                remoteVideo.play().catch(e => console.error('Error playing remote video:', e));
            }
        }
    };

    // Create offer if initiator with modern constraints
    if (isInitiator) {
        pc.createOffer()
        .then(offer => {
            return pc.setLocalDescription(offer);
        })
        .then(() => {
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription
            });
        })
        .catch(error => {
            console.error('Error creating offer:', error);
        });
    }
    
    return pc;
}

// Dynamically update call participants layout
function updateCallParticipantsLayout() {
    const remoteParticipants = document.getElementById('remoteParticipants');
    const allParticipants = [document.getElementById('localVideo').parentElement.parentElement, ...Array.from(remoteParticipants.children)];
    const numParticipants = allParticipants.length;

    const callParticipantsContainer = document.getElementById('callParticipantsContainer');

    // Reset grid-template-columns for flexibility
    callParticipantsContainer.style.gridTemplateColumns = ''; 
    callParticipantsContainer.style.gridAutoRows = '';

    if (numParticipants <= 1) {
        // Single participant, make it fill the space
        callParticipantsContainer.style.gridTemplateColumns = '1fr';
        callParticipantsContainer.style.gridAutoRows = '1fr';
    } else if (numParticipants === 2) {
        callParticipantsContainer.style.gridTemplateColumns = '1fr 1fr';
        callParticipantsContainer.style.gridAutoRows = '1fr';
    } else if (numParticipants === 3 || numParticipants === 4) {
        callParticipantsContainer.style.gridTemplateColumns = '1fr 1fr';
        callParticipantsContainer.style.gridAutoRows = '1fr 1fr';
    } else if (numParticipants > 4) {
        // For more than 4, try a more flexible grid, e.g., 3 columns if width allows
        callParticipantsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    }
    // Add logic for 'Speaker' mode (highlighting active speaker)
    // This is handled by socket.on('user-speaking') adding/removing 'speaking' class
    // No specific grid change needed for speaker mode, just styling in CSS.
}


// === PAN & ZOOM FUNCTIONALITY ===

function initializeZoom(container, videoElement) {
    if(!container || !videoElement) return;

    // Retrieve or initialize zoom state for this video
    let state = zoomStates.get(videoElement.id);
    if (!state) {
        state = {
            scale: 1,
            pointX: 0,
            pointY: 0,
            panning: false,
            startX: 0,
            startY: 0
        };
        zoomStates.set(videoElement.id, state);
    }

    function setTransform() {
        videoElement.style.transform = `translate(${state.pointX}px, ${state.pointY}px) scale(${state.scale})`;
    }

    // Reset zoom state
    function resetZoom(container, video) {
        if (!container || !video) return;
        const s = zoomStates.get(video.id);
        if (s) {
            s.scale = 1;
            s.pointX = 0;
            s.pointY = 0;
            setTransform();
            container.style.cursor = 'grab';
            const participantDiv = container.closest('.participant');
            if (participantDiv) {
                participantDiv.classList.remove('fullscreen');
            }
            document.getElementById('callInterface').classList.remove('fullscreen');
        }
    }

    // Mouse Wheel Zoom
    container.onwheel = (e) => {
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newScale = Math.min(Math.max(1, state.scale + delta), 5); // Limit zoom 1x to 5x
        
        // Update scale and adjust pan to zoom towards mouse
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        state.pointX -= (mouseX - state.pointX / state.scale) * (newScale / state.scale - 1);
        state.pointY -= (mouseY - state.pointY / state.scale) * (newScale / state.scale - 1);
        state.scale = newScale;
        
        // Reset pan if zoomed out to 1
        if (state.scale === 1) {
            state.pointX = 0;
            state.pointY = 0;
        }

        setTransform();
        container.style.cursor = state.scale > 1 ? 'grab' : 'default';
    };

    // Panning (Mouse Down/Move)
    container.onmousedown = (e) => {
        if (e.button === 0 && state.scale > 1) { // Left click only for panning
            e.preventDefault();
            state.panning = true;
            state.startX = e.clientX - state.pointX;
            state.startY = e.clientY - state.pointY;
            container.style.cursor = 'grabbing';
        }
    };

    container.onmousemove = (e) => {
        if (!state.panning) return;
        e.preventDefault();
        
        state.pointX = e.clientX - state.startX;
        state.pointY = e.clientY - state.startY;
        
        setTransform();
    };

    container.onmouseup = () => {
        if (state.panning) {
            state.panning = false;
            container.style.cursor = state.scale > 1 ? 'grab' : 'default';
        }
    };

    // Double-tap/Double-click to fullscreen
    container.ondblclick = (e) => {
        e.preventDefault();
        const participantDiv = container.closest('.participant');
        if (!participantDiv) return;

        const callInterface = document.getElementById('callInterface');

        if (participantDiv.classList.contains('fullscreen')) {
            // Exit fullscreen
            participantDiv.classList.remove('fullscreen');
            callInterface.classList.remove('fullscreen');
            resetZoom(container, videoElement); // Reset zoom on exit
        } else {
            // Enter fullscreen for this participant
            document.querySelectorAll('.participant.fullscreen').forEach(p => p.classList.remove('fullscreen')); // Ensure only one is fullscreen
            participantDiv.classList.add('fullscreen');
            callInterface.classList.add('fullscreen');
            resetZoom(container, videoElement); // Reset zoom on enter
            // Optionally, fit the video better in fullscreen
            // videoElement.style.objectFit = 'contain';
        }
    };

    // Touch Pinch-to-Zoom (basic implementation)
    let initialDistance = null;
    let initialScale = 1;

    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault(); // Prevent default browser zoom
            initialDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            initialScale = state.scale;
        } else if (e.touches.length === 1 && state.scale > 1) {
            e.preventDefault();
            state.panning = true;
            state.startX = e.touches[0].clientX - state.pointX;
            state.startY = e.touches[0].clientY - state.pointY;
            container.style.cursor = 'grabbing';
        }
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialDistance) {
            e.preventDefault(); // Prevent default browser zoom
            const currentDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            const scaleFactor = currentDistance / initialDistance;
            const newScale = Math.min(Math.max(1, initialScale * scaleFactor), 5);

            // Adjust pan to zoom towards center of pinch
            const rect = container.getBoundingClientRect();
            const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            state.pointX -= (centerX - state.pointX / state.scale) * (newScale / state.scale - 1);
            state.pointY -= (centerY - state.pointY / state.scale) * (newScale / state.scale - 1);
            state.scale = newScale;

            setTransform();
            container.style.cursor = state.scale > 1 ? 'grab' : 'default';
        } else if (e.touches.length === 1 && state.panning) {
            e.preventDefault();
            state.pointX = e.touches[0].clientX - state.startX;
            state.pointY = e.touches[0].clientY - state.startY;
            setTransform();
        }
    }, { passive: false });

    container.addEventListener('touchend', () => {
        initialDistance = null;
        state.panning = false;
        container.style.cursor = state.scale > 1 ? 'grab' : 'default';
    });
}