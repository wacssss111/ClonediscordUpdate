
// Global state
let currentChannel = 'general';
let channels = { 'general': [], 'random': [] };
let servers = [];
let groups = [];
let inCall = false;
let localStream = null;
let screenStream = null;
let peerConnections = {};
let isVideoEnabled = true;
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

// Zoom State
let zoomState = {
    isDragging: false,
    startX: 0,
    startY: 0,
    activeElement: null,
    transform: { x: 0, y: 0, scale: 1 }
};


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
    
    if (userAvatar) userAvatar.textContent = currentUser.avatar;
    if (username) username.textContent = currentUser.username;
}

function connectToSocketIO() {
    if (typeof io !== 'undefined') {
        socket = io({ auth: { token: token } });
        
        socket.on('connect', () => {
            console.log('Connected to server');
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
            
            if (channelName === currentChannel && currentView === 'server') {
                addMessageToUI(data.message);
                scrollToBottom();
            }
            
            if (document.hidden) {
                showNotification('New Message', `${data.message.author}: ${data.message.text}`);
            }
        });

        // Group Messages
        socket.on('new-group-message', (data) => {
            if (currentView === 'group' && currentGroupId === data.groupId) {
                addMessageToUI(data.message);
                scrollToBottom();
            } else {
                // Optional: Show notification or badge
                if (document.hidden) showNotification('Group Message', data.message.text);
            }
        });
        
        socket.on('reaction-update', (data) => {
            updateMessageReactions(data.messageId, data.reactions);
        });

        // WebRTC Signaling
        socket.on('user-joined-voice', (data) => {
            console.log('User joined voice:', data);
            createPeerConnection(data.socketId, true);
        });

        socket.on('existing-voice-users', (users) => {
            users.forEach(user => {
                createPeerConnection(user.socketId, false);
            });
        });

        socket.on('user-left-voice', (socketId) => {
            if (peerConnections[socketId]) {
                peerConnections[socketId].close();
                delete peerConnections[socketId];
            }
            const participantDiv = document.getElementById(`participant-${socketId}`);
            if (participantDiv) participantDiv.remove();
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
        socket.on('new-dm', (data) => {
            if (currentView === 'dm' && data.senderId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: data.message.author,
                    avatar: data.message.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('dm-sent', (data) => {
            if (currentView === 'dm' && data.receiverId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: currentUser.username,
                    avatar: currentUser.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('new-friend-request', () => {
            loadPendingRequests();
            showNotification('New Friend Request', 'You have a new friend request!');
        });

        socket.on('incoming-call', (data) => {
            const { from, type } = data;
            if (from) {
                showIncomingCall(from, type);
            }
        });

        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from);
            // When call is accepted, create peer connection
            document.querySelector('.call-channel-name').textContent = `Connected with ${data.from.username}`;
            
            // Create peer connection as initiator
            if (!peerConnections[data.from.socketId]) {
                createPeerConnection(data.from.socketId, true);
            }
        });

        socket.on('call-rejected', (data) => {
            alert('Call was declined');
            // Close call interface
            const callInterface = document.getElementById('callInterface');
            callInterface.classList.add('hidden');
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            inCall = false;
        });
        
        socket.on('call-ended', (data) => {
            // Handle when other party ends the call
            if (peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
            }
            const participantDiv = document.getElementById(`participant-${data.from}`);
            if (participantDiv) participantDiv.remove();
            
            // If no more connections, end the call
            if (Object.keys(peerConnections).length === 0) {
                leaveVoiceChannel(true);
            }
        });
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
    
    document.querySelectorAll('.friends-list').forEach(l => l.classList.remove('active-tab'));
    const contentMap = {
        'online': 'friendsOnline',
        'all': 'friendsAll',
        'pending': 'friendsPending',
        'add': 'friendsAdd'
    };
    document.getElementById(contentMap[tabName]).classList.add('active-tab');
    
    if (tabName === 'pending') {
        loadPendingRequests();
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
        onlineList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        allList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status === 'Online');
    
    if (onlineFriends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No one is online</div>';
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
    
    div.innerHTML = `
        <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${friend.status === 'Online' ? '' : 'offline'}">${friend.status}</div>
        </div>
        <div class="friend-actions">
            <button class="friend-action-btn message" title="Message">💬</button>
            <button class="friend-action-btn audio-call" title="Audio Call">📞</button>
            <button class="friend-action-btn video-call" title="Video Call">📹</button>
            <button class="friend-action-btn remove" title="Remove">🗑️</button>
        </div>
    `;

    div.querySelector('.message').addEventListener('click', () => startDM(friend.id, friend.username));
    div.querySelector('.audio-call').addEventListener('click', () => initiateCall(friend.id, 'audio'));
    div.querySelector('.video-call').addEventListener('click', () => initiateCall(friend.id, 'video'));
    div.querySelector('.remove').addEventListener('click', () => removeFriend(friend.id));
    
    return div;
}

async function searchUsers() {
    const searchInput = document.getElementById('searchUserInput');
    const query = searchInput.value.trim();
    
    if (!query) return;
    
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
    }
}

function displaySearchResults(users) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    
    if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="friends-empty">No users found</div>';
        return;
    }
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-search-item';
        
        div.innerHTML = `
            <div class="user-avatar">${user.avatar || user.username.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.username}</div>
            </div>
            <button class="add-friend-btn" onclick="sendFriendRequest(${user.id})">Add Friend</button>
        `;
        
        resultsDiv.appendChild(div);
    });
}

window.sendFriendRequest = async function(friendId) {
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
            alert('Friend request sent!');
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to send request');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        alert('Failed to send friend request');
    }
};

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const requests = await response.json();
        
        const pendingList = document.getElementById('friendsPending');
        pendingList.innerHTML = '';
        
        if (requests.length === 0) {
            pendingList.innerHTML = '<div class="friends-empty">No pending requests</div>';
            return;
        }
        
        requests.forEach(request => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            
            div.innerHTML = `
                <div class="friend-avatar">${request.avatar || request.username.charAt(0).toUpperCase()}</div>
                <div class="friend-info">
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Incoming Friend Request</div>
                </div>
                <div class="friend-actions">
                    <button class="friend-action-btn accept" onclick="acceptFriendRequest(${request.id})">✓</button>
                    <button class="friend-action-btn reject" onclick="rejectFriendRequest(${request.id})">✕</button>
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

window.removeFriend = async function(friendId) {
    if (!confirm('Are you sure you want to remove this friend?')) return;
    
    try {
        const response = await fetch(`/api/friends/${friendId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Error removing friend:', error);
    }
};

// === GROUP MANAGEMENT ===

function initializeGroupManagement() {
    const createGroupBtn = document.getElementById('createGroupBtn');
    const modal = document.getElementById('createGroupModal');
    const closeModalBtn = modal.querySelector('.close-modal-btn');
    const cancelBtn = modal.querySelector('.cancel-btn');
    const confirmBtn = modal.querySelector('.create-btn');

    createGroupBtn.addEventListener('click', async () => {
        modal.classList.remove('hidden');
        await populateFriendSelection();
    });

    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
    cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

    confirmBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('groupNameInput');
        const name = nameInput.value.trim();
        if(!name) return alert('Please enter a group name');

        const selectedFriends = Array.from(document.querySelectorAll('.friend-select-item.selected'))
            .map(el => parseInt(el.dataset.id));
        
        if(selectedFriends.length > 9) return alert('Max 9 friends allowed (10 total including you)');

        await createGroup(name, selectedFriends);
        modal.classList.add('hidden');
        nameInput.value = '';
    });
}

async function populateFriendSelection() {
    const list = document.getElementById('friendSelectionList');
    list.innerHTML = 'Loading friends...';
    
    try {
        const response = await fetch('/api/friends', {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await response.json();
        list.innerHTML = '';
        
        if(friends.length === 0) {
            list.innerHTML = '<div>No friends to invite</div>';
            return;
        }

        friends.forEach(friend => {
            const item = document.createElement('div');
            item.className = 'friend-select-item';
            item.dataset.id = friend.id;
            item.innerHTML = `
                <div class="checkbox"></div>
                <span>${friend.username}</span>
            `;
            item.addEventListener('click', () => {
                item.classList.toggle('selected');
            });
            list.appendChild(item);
        });

    } catch(e) {
        console.error(e);
        list.innerHTML = 'Error loading friends';
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
            alert('Failed to create group');
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
       groupHeader.innerText = 'GROUPS';
       dmList.appendChild(groupHeader);

       groups.forEach(group => {
           const item = document.createElement('div');
           item.className = 'channel';
           item.setAttribute('data-group-id', group.id);
           item.innerHTML = `
               <div class="friend-avatar" style="border-radius: 8px;">${group.name.charAt(0).toUpperCase()}</div>
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
   friendHeader.innerText = 'FRIENDS';
   dmList.appendChild(friendHeader);

   if (friends.length === 0) {
       const emptyDM = document.createElement('div');
       emptyDM.className = 'empty-dm-list';
       emptyDM.textContent = 'No conversations yet.';
       dmList.appendChild(emptyDM);
       return;
   }

   friends.forEach(friend => {
       const dmItem = document.createElement('div');
       dmItem.className = 'channel';
       dmItem.setAttribute('data-dm-id', friend.id);
       dmItem.innerHTML = `
           <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
           <span>${friend.username}</span>
       `;
       dmItem.addEventListener('click', () => {
           startDM(friend.id, friend.username);
       });
       dmList.appendChild(dmItem);
   });
}

async function startGroupChat(group) {
    currentView = 'group';
    currentGroupId = group.id;
    currentDMUserId = null;
    currentServerId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <div class="friend-avatar" style="border-radius: 8px;">${group.name.charAt(0).toUpperCase()}</div>
        <span class="channel-name">${group.name}</span>
    `;
    
    // Enable Group Call Button
    const groupCallBtn = document.getElementById('groupCallBtn');
    groupCallBtn.style.display = 'flex';
    groupCallBtn.onclick = () => joinGroupCall(group.id);
    
    document.getElementById('messageInput').placeholder = `Message ${group.name}`;
    
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

async function joinGroupCall(groupId) {
     if (inCall) {
        document.getElementById('callInterface').classList.remove('hidden');
        return;
    }
    
    inCall = true;
    const callInterface = document.getElementById('callInterface');
    callInterface.classList.remove('hidden');
    document.querySelector('.call-channel-name').textContent = `Group Call`;

    try {
        await initializeMedia();
        if (socket && socket.connected) {
            socket.emit('join-group-voice', { groupId: groupId });
        }
    } catch (e) {
        console.error(e);
        leaveVoiceChannel(true);
    }
}


// Initiate call function
async function initiateCall(friendId, type) {
    try {
        // Always request both video and audio, but disable video if it's audio call
        const constraints = { video: true, audio: true };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // If audio call, disable video track initially
        if (type === 'audio') {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        
        // Update call header
        document.querySelector('.call-channel-name').textContent = `Calling...`;
        
        // Set local video
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Initialize Zoom for local video
        initializeZoom(localVideo.parentElement);

        // Store call details
        window.currentCallDetails = {
            friendId: friendId,
            type: type,
            isInitiator: true,
            originalType: type
        };
        
        // Emit call request via socket
        if (socket && socket.connected) {
            socket.emit('initiate-call', {
                to: friendId,
                type: type,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id
                }
            });
        }
        
        inCall = true;
        isVideoEnabled = type === 'video';
        isAudioEnabled = true;
        updateCallButtons();
        
    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
    }
}

// Show incoming call notification
function showIncomingCall(caller, type) {
    const incomingCallDiv = document.getElementById('incomingCall');
    const callerName = incomingCallDiv.querySelector('.caller-name');
    const callerAvatar = incomingCallDiv.querySelector('.caller-avatar');
    
    callerName.textContent = caller.username || 'Unknown User';
    callerAvatar.textContent = caller.avatar || caller.username?.charAt(0).toUpperCase() || 'U';
    
    incomingCallDiv.classList.remove('hidden');
    
    // Set up accept/reject handlers
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    
    acceptBtn.onclick = async () => {
        incomingCallDiv.classList.add('hidden');
        await acceptCall(caller, type);
    };
    
    rejectBtn.onclick = () => {
        incomingCallDiv.classList.add('hidden');
        rejectCall(caller);
    };
    
    // Auto-reject after 30 seconds
    setTimeout(() => {
        if (!incomingCallDiv.classList.contains('hidden')) {
            incomingCallDiv.classList.add('hidden');
            rejectCall(caller);
        }
    }, 30000);
}

// Accept incoming call
async function acceptCall(caller, type) {
    try {
        // Always request both video and audio
        const constraints = { video: true, audio: true };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // If audio call, disable video track initially
        if (type === 'audio') {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        // Show call interface
        const callInterface = document.getElementById('callInterface');
        callInterface.classList.remove('hidden');
        
        document.querySelector('.call-channel-name').textContent = `Call with ${caller.username}`;
        
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        
        // Initialize zoom for local video
        initializeZoom(localVideo.parentElement);

        // Store call details
        window.currentCallDetails = {
            peerId: caller.socketId,
            type: type,
            isInitiator: false,
            originalType: type
        };
        
        if (socket && socket.connected) {
            socket.emit('accept-call', {
                to: caller.socketId,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id
                }
            });
        }
        
        inCall = true;
        isVideoEnabled = type === 'video';
        isAudioEnabled = true;
        updateCallButtons();
        
        // Create peer connection as receiver (not initiator)
        if (!peerConnections[caller.socketId]) {
            createPeerConnection(caller.socketId, false);
        }
        
    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
    }
}

// Reject incoming call
function rejectCall(caller) {
    if (socket && socket.connected) {
        socket.emit('reject-call', { to: caller.socketId });
    }
}

window.startDM = async function(friendId, friendUsername) {
    currentView = 'dm';
    currentDMUserId = friendId;
    currentServerId = null;
    currentGroupId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <div class="friend-avatar">${friendUsername.charAt(0).toUpperCase()}</div>
        <span class="channel-name">${friendUsername}</span>
    `;
    
    // Disable Group Call Button for DMs for now (use dedicated buttons)
    document.getElementById('groupCallBtn').style.display = 'none';

    document.getElementById('messageInput').placeholder = `Message @${friendUsername}`;
    
    await loadDMHistory(friendId);
};

// Show friends view
function showFriendsView() {
    currentView = 'friends';
    currentDMUserId = null;
    currentServerId = null;
    currentGroupId = null;

    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';
    
    document.getElementById('serverName').textContent = 'Friends';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
    
    // Hide chat and show friends content
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('friendsView').style.display = 'flex';
}

// Show server view
function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentDMUserId = null;
    currentGroupId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'block';
    document.getElementById('dmListView').style.display = 'none';

    document.getElementById('serverName').textContent = server.name;
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
    const addServerBtn = document.getElementById('addServerBtn');
    
    friendsBtn.addEventListener('click', () => {
        showFriendsView();
    });
    
    addServerBtn.addEventListener('click', () => {
        createNewServer();
    });
}

async function createNewServer() {
    const serverName = prompt('Enter server name:');
    
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
        alert('Failed to create server');
    }
}

function addServerToUI(server, switchTo = false) {
    const serverList = document.querySelector('.server-list');
    const addServerBtn = document.getElementById('addServerBtn');
    
    const serverIcon = document.createElement('div');
    serverIcon.className = 'server-icon';
    serverIcon.textContent = server.icon;
    serverIcon.title = server.name;
    serverIcon.setAttribute('data-server-id', server.id);
    
    serverIcon.addEventListener('click', () => {
        document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
        serverIcon.classList.add('active');
        showServerView(server);
    });
    
    serverList.insertBefore(serverIcon, addServerBtn);
    
    if (switchTo) {
        serverIcon.click();
    }
}

function initializeChannels() {
    const channelElements = document.querySelectorAll('.channel');
    
    channelElements.forEach(channel => {
        channel.addEventListener('click', () => {
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
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('active');
    
    document.getElementById('currentChannelName').textContent = channelName;
    document.getElementById('messageInput').placeholder = `Message #${channelName}`;
    
    loadChannelMessages(channelName);
}

async function loadChannelMessages(channelName) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';

    // For now, we'll use a hardcoded channel ID. This needs to be improved.
    const channelId = channelName === 'general' ? 1 : 2;

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
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.avatar;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = message.author;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = formatTimestamp(message.timestamp);
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    
    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'message-reactions';
    
    const addReactionBtn = document.createElement('button');
    addReactionBtn.className = 'add-reaction-btn';
    addReactionBtn.textContent = '😊';
    addReactionBtn.title = 'Add reaction';
    addReactionBtn.onclick = () => showEmojiPickerForMessage(message.id || Date.now());
    
    header.appendChild(author);
    header.appendChild(timestamp);
    content.appendChild(header);
    content.appendChild(text);
    content.appendChild(reactionsContainer);
    content.appendChild(addReactionBtn);
    
    messageGroup.appendChild(avatar);
    messageGroup.appendChild(content);
    
    messagesContainer.appendChild(messageGroup);
}

function formatTimestamp(date) {
    const messageDate = new Date(date);
    const hours = messageDate.getHours().toString().padStart(2, '0');
    const minutes = messageDate.getMinutes().toString().padStart(2, '0');
    return `Today at ${hours}:${minutes}`;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Emoji picker
function initializeEmojiPicker() {
    const emojiBtn = document.querySelector('.emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', () => {
            showEmojiPickerForInput();
        });
    }
}

function showEmojiPickerForInput() {
    const emojis = ['😀', '😂', '❤️', '👍', '👎', '🎉', '🔥', '✨', '💯', '🚀'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        const input = document.getElementById('messageInput');
        input.value += emoji;
        input.focus();
    });
    document.body.appendChild(picker);
}

function showEmojiPickerForMessage(messageId) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        addReaction(messageId, emoji);
    });
    document.body.appendChild(picker);
}

function createEmojiPicker(emojis, onSelect) {
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            onSelect(emoji);
            picker.remove();
        });
        picker.appendChild(btn);
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closePickerAnywhere(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePickerAnywhere);
            }
        });
    }, 100);
    
    return picker;
}

function addReaction(messageId, emoji) {
    if (socket && socket.connected) {
        socket.emit('add-reaction', { messageId, emoji });
    }
}

function updateMessageReactions(messageId, reactions) {
    const reactionsContainer = document.querySelector(`[data-message-id="${messageId}"] .message-reactions`);
    if (!reactionsContainer) return;
    
    reactionsContainer.innerHTML = '';
    
    reactions.forEach(reaction => {
        const reactionEl = document.createElement('div');
        reactionEl.className = 'reaction';
        reactionEl.innerHTML = `${reaction.emoji} <span>${reaction.count}</span>`;
        reactionEl.title = reaction.users;
        reactionEl.addEventListener('click', () => {
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
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await uploadFile(file);
        }
        fileInput.value = '';
    });
}

async function uploadFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('channelId', currentChannel);
        
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        const fileData = await response.json();
        
        const message = {
            author: currentUser.username,
            avatar: currentUser.avatar,
            text: `Uploaded ${file.name}`,
            file: fileData,
            timestamp: new Date()
        };
        
        if (socket && socket.connected) {
            socket.emit('send-message', {
                channel: currentChannel,
                message: message
            });
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload file');
    }
}

// User controls
function initializeUserControls() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.querySelector('.icon-normal').style.display = isMuted ? 'none' : 'block';
        muteBtn.querySelector('.icon-slashed').style.display = isMuted ? 'block' : 'none';
        
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
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
            }
            
            // Mute all remote audio
            document.querySelectorAll('video[id^="remote-"]').forEach(video => {
                video.volume = 0;
            });
        } else {
            // Unmute remote audio
            document.querySelectorAll('video[id^="remote-"]').forEach(video => {
                video.volume = 1;
            });
        }

        // Update local stream audio tracks
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    settingsBtn.addEventListener('click', () => {
        if (confirm('Do you want to logout?')) {
            if (inCall) leaveVoiceChannel();
            localStorage.removeItem('token');
            localStorage.removeItem('currentUser');
            if (socket) socket.disconnect();
            window.location.replace('login.html');
        }
    });
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
        await initializeMedia();
        
        // Connect to the socket for voice
        if (socket && socket.connected) {
            socket.emit('join-voice-channel', { channelName, userId: currentUser.id });
        }

    } catch (error) {
        console.error('Error initializing media:', error);
        alert('Error accessing camera/microphone. Please grant permissions.');
        leaveVoiceChannel(true); // Force leave
    }
}

async function initializeMedia() {
    try {
        // Better audio constraints for clear voice
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
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
        
        // Initialize Zoom for local video (optional, usually you don't zoom yourself, but consistent UI)
        initializeZoom(localVideo.parentElement);

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
             } else {
                 socket.emit('leave-voice-channel', currentChannel);
             }
        }

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};

        document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
        document.getElementById('remoteParticipants').innerHTML = '';
    }

    const callInterface = document.getElementById('callInterface');
    callInterface.classList.add('hidden');

    if (force) {
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = null;
        // Reset Zoom
        if(localVideo.parentElement) {
             const v = localVideo;
             v.style.transform = `translate(0px, 0px) scale(1)`;
        }
        isVideoEnabled = true;
        isAudioEnabled = true;
        updateCallButtons();
    }
}

function initializeCallControls() {
    const closeCallBtn = document.getElementById('closeCallBtn');
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    closeCallBtn.addEventListener('click', () => {
        // End call for both voice channels and direct calls
        if (window.currentCallDetails) {
            // End a direct call
            Object.keys(peerConnections).forEach(socketId => {
                if (socket && socket.connected) {
                    socket.emit('end-call', { to: socketId });
                }
            });
        }
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
    
    if (!isAudioEnabled) {
        isMuted = true;
        document.getElementById('muteBtn').classList.add('active');
    } else {
        isMuted = false;
        document.getElementById('muteBtn').classList.remove('active');
    }
    
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
            
            // Handle screen share ending
            screenTrack.addEventListener('ended', () => {
                toggleScreenShare(); // This will stop screen sharing
            });
            
            updateCallButtons();
        } catch (error) {
            console.error('Error sharing screen:', error);
            if (error.name === 'NotAllowedError') {
                alert('Screen sharing permission denied');
            } else {
                alert('Error sharing screen. Please try again.');
            }
        }
    }
}

function updateCallButtons() {
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    if (toggleVideoBtn) {
        toggleVideoBtn.classList.toggle('active', !isVideoEnabled);
    }
    
    if (toggleAudioBtn) {
        toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('active', screenStream !== null);
    }
}

function initializeDraggableCallWindow() {
   const callInterface = document.getElementById('callInterface');
   const callHeader = callInterface.querySelector('.call-header');
   let isDragging = false;
   let offsetX, offsetY;

   callHeader.addEventListener('mousedown', (e) => {
       isDragging = true;
       offsetX = e.clientX - callInterface.offsetLeft;
       offsetY = e.clientY - callInterface.offsetTop;
       callInterface.style.transition = 'none'; // Disable transition during drag
   });

   document.addEventListener('mousemove', (e) => {
       if (isDragging) {
           let newX = e.clientX - offsetX;
           let newY = e.clientY - offsetY;

           // Constrain within viewport
           const maxX = window.innerWidth - callInterface.offsetWidth;
           const maxY = window.innerHeight - callInterface.offsetHeight;

           newX = Math.max(0, Math.min(newX, maxX));
           newY = Math.max(0, Math.min(newY, maxY));

           callInterface.style.left = `${newX}px`;
           callInterface.style.top = `${newY}px`;
       }
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
   return name === 'general' ? 1 : 2;
}

function getChannelNameById(id) {
   // This is a temporary solution. A better approach would be to have a proper mapping.
   return id === 1 ? 'general' : 'random';
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
                   timestamp: message.created_at
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
            
            // Zoom container wrapper
            zoomContainer = document.createElement('div');
            zoomContainer.className = 'zoom-container';

            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-${remoteSocketId}`;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideo.volume = isDeafened ? 0 : 1;
            
            const participantName = document.createElement('div');
            participantName.className = 'participant-name';
            participantName.textContent = 'Participant'; // Could fetch name via Socket
            
            zoomContainer.appendChild(remoteVideo);
            participantDiv.appendChild(zoomContainer);
            participantDiv.appendChild(participantName);
            remoteParticipants.appendChild(participantDiv);

            // Initialize Pan/Zoom Logic
            initializeZoom(zoomContainer);
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


// === PAN & ZOOM FUNCTIONALITY ===

function initializeZoom(container) {
    if(!container) return;

    let scale = 1;
    let pointX = 0;
    let pointY = 0;
    let panning = false;
    let startX = 0;
    let startY = 0;
    
    const video = container.querySelector('video');

    function setTransform() {
        video.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    }

    // Wheel Zoom
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newScale = Math.min(Math.max(1, scale + delta), 5); // Limit zoom 1x to 5x
        
        scale = newScale;
        
        // Reset pan if zoomed out to 1
        if (scale === 1) {
            pointX = 0;
            pointY = 0;
        }

        setTransform();
    });

    // Panning
    container.addEventListener('mousedown', (e) => {
        if (scale > 1) {
            e.preventDefault();
            panning = true;
            startX = e.clientX - pointX;
            startY = e.clientY - pointY;
            container.style.cursor = 'grabbing';
        }
    });

    container.addEventListener('mousemove', (e) => {
        if (!panning) return;
        e.preventDefault();
        
        pointX = e.clientX - startX;
        pointY = e.clientY - startY;
        
        setTransform();
    });

    document.addEventListener('mouseup', () => {
        panning = false;
        container.style.cursor = scale > 1 ? 'grab' : 'default';
    });
}
