document.addEventListener('DOMContentLoaded', () => {
    // Firebase Integration
    let isFirebaseReady = false;
    let firebaseRetryCount = 0;
    const maxFirebaseRetries = 5;
    
    // Check if Firebase is configured properly
    function checkFirebaseConfig() {
        if (typeof firebase !== 'undefined' && window.database) {
            const config = firebase.apps[0].options;
            const isValidApiKey = config.apiKey && config.apiKey !== "YOUR_API_KEY" && config.apiKey.length > 10;
            const isValidDbUrl = config.databaseURL && !config.databaseURL.includes("YOUR_PROJECT");

            return isValidApiKey && isValidDbUrl;
        }
        console.log('❌ Firebase or database not found');
        return false;
    }
    
    // Initialize Firebase connection (Simplified)
    function initializeFirebase() {
        return new Promise((resolve) => {
            if (!checkFirebaseConfig()) {
                console.warn('Firebase chưa được cấu hình. Sử dụng chế độ offline.');
                resolve(false);
                return;
            }
            
            console.log('🔥 Testing Firebase connection...');
            
            try {
                // Simple connection test
                const connectedRef = window.database.ref('.info/connected');
                let resolved = false;
                
                // Set a longer timeout for Firebase connection
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        console.warn('🔥 Firebase connection timeout after 15 seconds');
                        resolved = true;
                        resolve(false);
                    }
                }, 15000);
                
                connectedRef.on('value', (snapshot) => {
                    const connected = snapshot.val() === true;
                    
                    if (connected && !resolved) {
                        // Skip write test for now - just declare ready
                        isFirebaseReady = true;
                        
                        clearTimeout(timeout);
                        resolved = true;
                        resolve(true);
                        
                    } else if (!connected) {
                        isFirebaseReady = false;
                        // DON'T resolve(false) immediately - wait for connection
                    }
                }, (error) => {
                    console.error('🔥 Firebase connection error:', error);
                    if (!resolved) {
                        clearTimeout(timeout);
                        resolved = true;
                        resolve(false);
                    }
                });
                
            } catch (error) {
                console.error('🔥 Firebase initialization error:', error);
                resolve(false);
            }
        });
    }
    
    // Online presence system
    function setupOnlinePresence() {
        if (!isFirebaseReady) return;
        
        const presenceRef = window.database.ref('presence/' + myId);
        const connectedRef = window.database.ref('.info/connected');
        
        connectedRef.on('value', (snapshot) => {
            if (snapshot.val() === true) {
                // User is online
                presenceRef.set({
                    online: true,
                    lastSeen: firebase.database.ServerValue.TIMESTAMP,
                    avatar: getAvatarUrl(myId),
                    userId: myId
                });
                
                // Remove presence when user disconnects
                presenceRef.onDisconnect().remove();
                
                // Setup real-time online count listener
                setupOnlineCountListener();
            }
        });
    }
    
    // Setup realtime online count listener
    function setupOnlineCountListener() {
        if (!isFirebaseReady) return;
        
        // Remove any existing listener to prevent duplicates
        window.database.ref('presence').off('value');
        
        window.database.ref('presence').on('value', (snapshot) => {
            const presence = snapshot.val();
            const onlineCount = presence ? Object.keys(presence).length : 1;
            onlineUsers = Math.max(onlineCount, 1);
            
            if (onlineCountEl) {
                onlineCountEl.textContent = onlineUsers;
            }
            

        });
    }
    
    // Get real online count
    function getOnlineCount(callback) {
        if (!isFirebaseReady) {
            callback(Math.floor(Math.random() * (250 - 50 + 1)) + 50);
            return;
        }
        
        // Use the realtime listener instead
        setupOnlineCountListener();
    }
    
    // Diagnostic function to test Firebase access
    async function testFirebaseAccess() {
        console.log('🔍 Running Firebase diagnostic...');
        
        try {
            // Test 1: Check if database reference works
            const testRef = window.database.ref('test');
            console.log('✅ Test 1: Database reference created');
            
            // Test 2: Try to read presence
            const presenceTest = await window.database.ref('presence').once('value');
            console.log('✅ Test 2: Presence read successful, data:', presenceTest.val());
            
            // Test 3: Try to write test data
            await testRef.set({
                test: true,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userId: myId
            });
            console.log('✅ Test 3: Write test successful');
            
            // Test 4: Try to read test data back
            const readTest = await testRef.once('value');
            console.log('✅ Test 4: Read test successful, data:', readTest.val());
            
            // Test 5: Clean up test data
            await testRef.remove();
            console.log('✅ Test 5: Cleanup successful');
            
            console.log('🎉 All Firebase tests passed!');
            return true;
            
        } catch (error) {
            console.error('❌ Firebase diagnostic failed:', error);
            console.error('❌ Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    // Initialize feed manager
    async function initializeFeedManager() {
        try {
            feedManager = new FirebaseFeedManager();
            await feedManager.init();
        } catch (error) {
            console.error('❌ Feed manager initialization failed:', error);
        }
    }
    
    // Firebase Chat System với Chat History Management
    // Features:
    // 1. Chat mới mỗi khi connect với người khác
    // 2. Auto-delete chat sau 5 phút khi không active
    // 3. Reuse chat history nếu match lại cùng người
    // 4. Comprehensive error handling và debugging
    class FirebaseChat {
        constructor() {
            this.chatRef = null;
            this.currentChatId = null;
            this.waitingQueue = null;
            this.currentPartner = null;
            this.lastActivity = Date.now();
            this.cleanupTimer = null;
        }
        
        // 🔧 SIMPLIFIED: Find or create chat with streamlined logic
        async findChat() {
            if (!isFirebaseReady) {
                console.error('❌ Firebase not ready in findChat');
                throw new Error('Firebase not ready');
            }
            
            console.log('🔍 Finding chat...');
            updateConnectionStatus('connecting', 'Đang tìm người...');
            
            try {
                // Step 1: Join waiting queue
                await this.joinWaitingQueue();
                
                // Step 2: Look for existing waiting chats to join
                console.log('🔍 Searching for available chats...');
                const chatsRef = window.database.ref('chats');
                const snapshot = await chatsRef.orderByChild('status').equalTo('waiting').once('value');
                
                if (snapshot.exists()) {
                    const chatData = snapshot.val();
                    const waitingChats = Object.keys(chatData);
                    
                    console.log(`📊 Found ${waitingChats.length} waiting chats`);
                    
                    // Check online presence for validation
                    const presenceSnapshot = await window.database.ref('presence').once('value');
                    const onlineUsers = presenceSnapshot.val();
                    const onlineUserIds = onlineUsers ? Object.keys(onlineUsers).filter(id => id !== myId) : [];
                    
                    // Try to join any suitable waiting chat
                    for (const chatId of waitingChats) {
                        const chat = chatData[chatId];
                        const participantIds = Object.keys(chat.participants || {});
                        const otherUserId = participantIds.find(id => id !== myId);
                        
                        // Valid chat: 1 participant, not me, and they're online
                        if (participantIds.length === 1 && 
                            !chat.participants[myId] && 
                            otherUserId && 
                            onlineUserIds.includes(otherUserId)) {
                            
                            console.log(`✅ Joining chat: ${chatId} with user: ${otherUserId}`);
                            
                            try {
                                await this.joinExistingChat(chatId);
                                return chatId;
                            } catch (joinError) {
                                console.error(`❌ Failed to join chat ${chatId}:`, joinError);
                                continue; // Try next chat
                            }
                        }
                    }
                }
                
                // Step 3: No suitable chat found, create new one
                console.log('🆕 Creating new chat...');
                const chatId = await this.createChat();
                console.log('✅ Created chat:', chatId);
                return chatId;
                
            } catch (error) {
                console.error('❌ Error in findChat:', error);
                updateConnectionStatus('error', 'Lỗi kết nối');
                throw error;
            }
        }
        
        // Join waiting queue for matchmaking
        async joinWaitingQueue() {
            if (!isFirebaseReady) return;
            
            console.log('🚪 Joining waiting queue...');
            
            // First check if there are existing users in queue
            const existingQueueSnapshot = await window.database.ref('waitingQueue').once('value');
            const existingQueue = existingQueueSnapshot.val();
            
            if (existingQueue) {
                const existingUsers = Object.keys(existingQueue).filter(id => id !== myId);
                console.log('👀 Found existing users in queue:', existingUsers);
                
                // Try to match with first available user
                for (const userId of existingUsers) {
                    const userData = existingQueue[userId];
                    if (userData.status === 'waiting') {
                        console.log(`🎯 Attempting to match with existing user: ${userId}`);
                        
                        // Double-check the user is still in queue
                        const userCheck = await window.database.ref(`waitingQueue/${userId}`).once('value');
                        if (userCheck.exists() && userCheck.val().status === 'waiting') {
                            await this.findOrCreateChatWithUser(userId);
                            return; // Exit early - we found a match
                        }
                    }
                }
            }
            
            // No existing users to match with, join queue
            console.log('📝 Adding self to waiting queue...');
            this.waitingQueue = window.database.ref('waitingQueue/' + myId);
            await this.waitingQueue.set({
                userId: myId,
                avatar: getAvatarUrl(myId),
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                status: 'waiting'
            });
            
            // Remove from queue when disconnected
            this.waitingQueue.onDisconnect().remove();
            
            // Listen for NEW users joining queue
            this.listenForQueueMatch();
            
            // ENHANCED: Continuous retry system with escalating intervals
            const reCheckDelays = [1000, 2000, 3000, 5000, 10000, 15000]; // Up to 15s
            
            reCheckDelays.forEach((delay, index) => {
                setTimeout(async () => {
                    if (this.waitingQueue && !this.currentChatId) {
                        console.log(`🔄 Auto-retry #${index + 1} for matches after ${delay}ms...`);
                        
                        try {
                            // Also check for existing waiting chats, not just queue
                            const chatsSnapshot = await window.database.ref('chats').orderByChild('status').equalTo('waiting').once('value');
                            
                            if (chatsSnapshot.exists()) {
                                const waitingChats = chatsSnapshot.val();
                                const chatIds = Object.keys(waitingChats);
                                
                                console.log(`🎯 Auto-retry #${index + 1} found ${chatIds.length} waiting chats`);
                                
                                // Check online presence
                                const presenceSnapshot = await window.database.ref('presence').once('value');
                                const onlineUsers = presenceSnapshot.val();
                                const onlineUserIds = onlineUsers ? Object.keys(onlineUsers).filter(id => id !== myId) : [];
                                
                                // Try to join any compatible waiting chat
                                for (const chatId of chatIds) {
                                    const chat = waitingChats[chatId];
                                    const participantIds = Object.keys(chat.participants || {});
                                    const otherUserId = participantIds.find(id => id !== myId);
                                    
                                    if (participantIds.length === 1 && 
                                        !chat.participants[myId] && 
                                        otherUserId && 
                                        onlineUserIds.includes(otherUserId)) {
                                        
                                        console.log(`🚀 Auto-retry #${index + 1} joining waiting chat: ${chatId}`);
                                        try {
                                            await this.joinExistingChat(chatId);
                                            console.log(`✅ Auto-retry #${index + 1} successful!`);
                                            return; // Exit on success
                                        } catch (error) {
                                            console.error(`❌ Auto-retry #${index + 1} failed:`, error);
                                        }
                                    }
                                }
                            }
                            
                            // Fallback: Check queue as before
                            const queueSnapshot = await window.database.ref('waitingQueue').once('value');
                            const queueData = queueSnapshot.val();
                            
                            if (queueData) {
                                const otherUsers = Object.keys(queueData).filter(id => id !== myId);
                                console.log(`🎯 Auto-retry #${index + 1} found queue users:`, otherUsers);
                                
                                for (const userId of otherUsers) {
                                    const userData = queueData[userId];
                                    if (userData && userData.status === 'waiting') {
                                        try {
                                            const chatId = await this.findOrCreateChatWithUser(userId);
                                            if (chatId) {
                                                console.log(`✅ Auto-retry #${index + 1} queue match successful!`);
                                                return;
                                            }
                                        } catch (error) {
                                            console.error(`❌ Auto-retry #${index + 1} queue match failed:`, error);
                                        }
                                    }
                                }
                            }
                            
                        } catch (error) {
                            console.error(`❌ Auto-retry #${index + 1} system error:`, error);
                        }
                    }
                }, delay);
            });
            
            // ULTIMATE FALLBACK: After 30 seconds, do a complete refresh
            setTimeout(async () => {
                if (this.waitingQueue && !this.currentChatId) {
                    try {
                        // Clean up and restart
                        if (this.waitingQueue) {
                            await this.waitingQueue.remove();
                        }
                        this.cleanupLocalState();
                        
                        setTimeout(async () => {
                            await this.findChat();
                        }, 2000);
                        
                    } catch (error) {
                        console.error('❌ Auto-refresh failed:', error);
                    }
                }
            }, 30000); // 30 seconds
        }
        
        // 🔧 SIMPLIFIED: Listen for queue matches with cleaner logic
        listenForQueueMatch() {
            if (!isFirebaseReady) return;
            
            console.log('👂 Listening for queue matches...');
            
            const queueRef = window.database.ref('waitingQueue');
            
            // Clear existing listeners
            queueRef.off();
            
            // Listen for new users joining queue
            queueRef.on('child_added', async (snapshot) => {
                const userData = snapshot.val();
                const userId = snapshot.key;
                
                // Skip self and invalid data
                if (userId === myId || !userData || userData.status !== 'waiting') return;
                
                // Only match if we're still in queue and not in chat
                if (!this.waitingQueue || this.currentChatId) return;
                
                console.log(`🎯 New user in queue: ${userId}, attempting match...`);
                
                try {
                    // Verify user is still available
                    const userCheck = await window.database.ref(`waitingQueue/${userId}`).once('value');
                    if (userCheck.exists() && userCheck.val().status === 'waiting') {
                        const chatId = await this.findOrCreateChatWithUser(userId);
                        if (chatId) {
                            console.log(`✅ Match success with: ${userId}`);
                        }
                    }
                } catch (error) {
                    console.error(`❌ Match failed with ${userId}:`, error);
                }
            });
            
            // Listen for users leaving queue (cleanup)
            queueRef.on('child_removed', (snapshot) => {
                const userId = snapshot.key;
                console.log(`👋 User ${userId} left queue`);
            });
        }
        
        // Create new chat room
        async createChat() {
            if (!isFirebaseReady) return null;
            
            const chatRef = window.database.ref('chats').push();
            await chatRef.set({
                participants: { [myId]: true },
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                lastActivity: firebase.database.ServerValue.TIMESTAMP,
                status: 'waiting',
                participantCount: 1
            });
            
            this.joinChat(chatRef.key);
            updateConnectionStatus('connecting', 'Đang kết nối...');
            
            // Clear stranger info while waiting
            strangerIdEl.textContent = '';
            strangerAvatar.src = '';
            
            // Don't clear messages when creating new chat - let them accumulate
            console.log('📤 Creating new chat - messages will be preserved');
            
            // OPTIMIZED: Quick cleanup for waiting room - 1 minute only
            setTimeout(async () => {
                if (this.currentChatId === chatRef.key) {
                    const chatSnapshot = await chatRef.once('value');
                    const chatData = chatSnapshot.val();
                    if (chatData && chatData.participantCount === 1) {
                        console.log('⏰ Auto-deleting waiting room after timeout');
                        await chatRef.remove();
                        addMessage('system', '⏰ Không tìm thấy ai');
                        this.cleanupLocalState();
                        setTimeout(() => this.findChat(), 1000);
                    }
                }
            }, 60000); // 1 minute instead of 5
            
            return chatRef.key;
        }
        
        // Create new chat with specific user - NO HISTORY SYSTEM
        async findOrCreateChatWithUser(otherUserId) {
            if (!isFirebaseReady) return null;
            
            console.log(`🔍 Creating new chat with user: ${otherUserId}`);
            
            // Check if we already have a chat with this user to avoid duplicates
            if (this.currentChatId) {
                console.log('⚠️ Already in a chat, skipping match');
                return null;
            }
            
            try {
                // Always create new chat - NO HISTORY SYSTEM
                console.log(`🆕 Creating fresh chat with user: ${otherUserId}`);
                return await this.createNewChatWithUser(otherUserId);
                
            } catch (error) {
                console.error('Error creating chat with user:', error);
                addMessage('system', '❌ Không thể tạo chat. Thử lại sau!');
                return null;
            }
        }
        

        
        // Create simple new chat with user - NO HISTORY, AUTO DELETE
        async createNewChatWithUser(otherUserId) {
            if (!isFirebaseReady) return null;
            
            try {
                // Check if other user is still available
                const otherUserSnapshot = await window.database.ref(`waitingQueue/${otherUserId}`).once('value');
                if (!otherUserSnapshot.exists()) {
                    console.log(`⚠️ User ${otherUserId} no longer in queue, canceling chat creation`);
                    return null;
                }
                
                // Create new chat
                const chatRef = window.database.ref('chats').push();
                const chatId = chatRef.key;
                
                const chatData = {
                    participants: { 
                        [myId]: true,
                        [otherUserId]: true
                    },
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    lastActivity: firebase.database.ServerValue.TIMESTAMP,
                    status: 'active',
                    participantCount: 2,
                    creator: myId
                };
                
                console.log('📝 Simple chat data:', chatData);
                
                // Atomic update - create chat and remove both users from queue
                const updates = {};
                updates[`chats/${chatId}`] = chatData;
                updates[`waitingQueue/${myId}`] = null;
                updates[`waitingQueue/${otherUserId}`] = null;
                
                await window.database.ref().update(updates);
                
                console.log(`✅ Simple chat created with ID: ${chatId}`);
                
                // Clear local state and join chat
                this.waitingQueue = null;
                this.currentPartner = otherUserId;
                
                this.joinChat(chatId);
                
                // Don't clear messages when creating new chat with user
                console.log('📤 Creating new chat with user - messages will be preserved');
                
                // Clear all system messages when connected
                this.clearSystemMessages();
                
                // Don't add connection message anymore
                // addMessage('system', '🎉 Đã kết nối!');
                
                // Setup auto-cleanup (chat will be deleted when users disconnect)
                this.setupChatCleanup(chatId);
                
                return chatId;
                
            } catch (error) {
                console.error('Error creating simple chat:', error);
                throw error;
            }
        }
        

        
        // Join existing chat - IMPROVED CONNECTION
        async joinExistingChat(chatId) {
            if (!isFirebaseReady) return;
            
            console.log(`🚪 Joining existing chat: ${chatId}`);
            
            try {
                const chatRef = window.database.ref(`chats/${chatId}`);
                
                // Get current chat data to check who's there
                const chatSnapshot = await chatRef.once('value');
                const chatData = chatSnapshot.val();
                
                if (!chatData) {
                    console.log(`❌ Chat ${chatId} no longer exists`);
                    return;
                }
                
                const currentParticipants = Object.keys(chatData.participants || {});
                const otherUserId = currentParticipants.find(id => id !== myId);
                
                console.log(`👥 Joining chat with existing participants:`, currentParticipants);
                console.log(`🤝 Partner will be: ${otherUserId}`);
                
                // Add self to participants and update status to active
                const updates = {
                    [`participants/${myId}`]: true,
                    status: 'active',
                    participantCount: 2,
                    lastActivity: firebase.database.ServerValue.TIMESTAMP,
                    [`connectionStatus/${myId}`]: 'connected'
                };
                
                // Also set partner as connected if they exist
                if (otherUserId) {
                    updates[`connectionStatus/${otherUserId}`] = 'connected';
                    this.currentPartner = otherUserId;
                }
                
                await chatRef.update(updates);
                
                // Remove from waiting queue
                if (this.waitingQueue) {
                    await this.waitingQueue.remove();
                    this.waitingQueue = null;
                }
                
                // Remove from global waiting queue
                await window.database.ref(`waitingQueue/${myId}`).remove();
                
                // Join the chat locally
                this.joinChat(chatId);
                
                console.log(`✅ Successfully joined existing chat ${chatId} with ${otherUserId}`);
                
            } catch (error) {
                console.error(`❌ Error joining existing chat ${chatId}:`, error);
                throw error;
            }
        }
        
        // Join existing chat
        joinChat(chatId) {
            if (!isFirebaseReady) return;
            
            console.log(`🚪 Joining chat: ${chatId}`);
            
            // ⚠️ CRITICAL: Clean up old listeners first to prevent duplicates
            if (this.chatRef) {
                console.log('🧹 Cleaning up old chat listeners...');
                this.chatRef.off(); // Remove ALL listeners from old chat
            }
            
            // Don't clear messages when joining - let them load from Firebase
            console.log('📤 Joining chat - messages will be loaded from Firebase');
            
            this.currentChatId = chatId;
            this.chatRef = window.database.ref(`chats/${chatId}`);
            
            // Add self to participants
            this.chatRef.child('participants').child(myId).set(true);
            
            // Listen for messages
            this.listenForMessages();
            
            // Listen for participants
            this.listenForParticipants();
            
            // Listen for typing indicators
            this.listenForTyping();
            
            // OPTIMIZED: Setup auto-delete on disconnect (page close/refresh)
            this.setupOnDisconnectDelete();
            
            console.log(`✅ Joined chat: ${chatId} with all listeners active`);
        }
        
        // Send message using Firebase best practices - NO DUPLICATE DISPLAY
        sendMessage(text, replyTo = null) {
            if (!isFirebaseReady || !this.chatRef) {
                console.warn('❌ Cannot send message: Firebase not ready or no chat room');
                addMessage('system', '❌ Chưa kết nối Firebase. Thử lại!');
                return;
            }
            
            if (!text || !text.trim()) {
                console.warn('❌ Cannot send empty message');
                return;
            }
            
            // Check if chat is in waiting state - don't save messages to Firebase
            this.chatRef.once('value').then((snapshot) => {
                const chatData = snapshot.val();
                if (chatData && chatData.status === 'waiting') {
                    console.log('⏳ Chat is in waiting state - message will not be saved to Firebase');
                    // Display message locally only, don't save to Firebase
                    addMessage('me', text.trim(), {
                        isReply: !!replyTo,
                        replyToText: replyTo,
                        timestamp: Date.now(),
                        messageId: 'local-' + Date.now()
                    });
                    return;
                }
                
                // Chat is active - save to Firebase temporarily
                const messageData = {
                    senderId: myId,
                    text: text.trim(),
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                };
                
                // Add reply information if exists
                if (replyTo) {
                    messageData.replyTo = replyTo;
                }
                
                console.log(`📤 Sending message to active chat ${this.currentChatId}:`, {
                    senderId: messageData.senderId,
                    text: messageData.text.substring(0, 50) + (messageData.text.length > 50 ? '...' : ''),
                    hasReply: !!replyTo,
                    chatRef: !!this.chatRef
                });
                
                // Send to Firebase using push() for auto-generated unique keys
                const messagesRef = this.chatRef.child('messages');
                messagesRef.push(messageData).then((newMessageRef) => {
                    console.log('✅ Message sent successfully to Firebase with ID:', newMessageRef.key);
                    
                    // Update last activity and reset cleanup timer
                    this.updateLastActivity();
                    this.setupChatCleanup(this.currentChatId);
                    
                }).catch((error) => {
                    console.error('❌ Failed to send message to Firebase:', error);
                    addMessage('system', '❌ Không thể gửi tin nhắn. Lỗi: ' + error.message);
                });
            }).catch((error) => {
                console.error('❌ Failed to check chat status:', error);
                addMessage('system', '❌ Lỗi kiểm tra trạng thái chat!');
            });
        }
        
        // Listen for new messages using Firebase best practices
        listenForMessages() {
            if (!this.chatRef) return;
            
            const messagesRef = this.chatRef.child('messages');
            messagesRef.off(); // Clear existing listeners
            
            messagesRef.on('child_added', (snapshot) => {
                const message = snapshot.val();
                const messageId = snapshot.key;
                
                // Validate message data
                if (!message || !message.senderId || !message.text) {
                    console.warn('⚠️ Invalid message data:', message);
                    return;
                }
                
                // Only display messages from active chats (not waiting)
                this.chatRef.once('value').then((chatSnapshot) => {
                    const chatData = chatSnapshot.val();
                    if (chatData && chatData.status === 'active') {
                        // Display messages only in active chats
                        if (message.senderId !== myId) {
                            addMessage('stranger', message.text, {
                                isReply: !!message.replyTo,
                                replyToText: message.replyTo,
                                timestamp: message.timestamp,
                                messageId: messageId
                            });
                            
                            this.updateLastActivity();
                            this.setupChatCleanup(this.currentChatId);
                        } else {
                            addMessage('me', message.text, {
                                isReply: !!message.replyTo,
                                replyToText: message.replyTo,
                                timestamp: message.timestamp,
                                messageId: messageId
                            });
                        }
                    } else {
                        console.log('⏳ Ignoring message from waiting chat');
                    }
                }).catch((error) => {
                    console.error('❌ Failed to check chat status for message:', error);
                });
            }, (error) => {
                console.error('❌ Message listener error:', error);
                addMessage('system', '❌ Lỗi đồng bộ tin nhắn!');
            });
        }
        
        // 🔧 OPTIMIZED: Simplified participant listener with accurate state tracking
        listenForParticipants() {
            if (!this.chatRef) return;
            
            // Remove existing listener to prevent duplicates
            this.chatRef.child('participants').off('value');
            
            this.chatRef.child('participants').on('value', async (snapshot) => {
                const participants = snapshot.val();
                
                if (!participants) {
                    // No participants - chat is completely empty, cleanup and return to idle
                    console.log('🧹 No participants, cleaning up chat');
                    addMessage('system', '💬 Đoạn chat đã kết thúc');
                    this.cleanupLocalState();
                    return;
                }
                
                const participantIds = Object.keys(participants);
                const strangerIds = participantIds.filter(id => id !== myId);
                const participantCount = participantIds.length;
                
                console.log(`👥 Participants: ${participantCount} total, stranger: ${strangerIds[0] || 'none'}`);
                
                if (participantCount === 2 && strangerIds.length === 1) {
                    // ✅ CONNECTED STATE: Both users present
                    const currentStrangerId = strangerIds[0];
                    
                    if (strangerId !== currentStrangerId) {
                        const previousStrangerId = strangerId; // Store previous stranger for cleanup
                        
                        // New connection established
                        strangerId = currentStrangerId;
                        strangerIdEl.textContent = strangerId;
                        strangerAvatar.src = getAvatarUrl(strangerId);
                        updateConnectionStatus('connected', 'Đã kết nối');
                        
                        // Clear all system messages when connected
                        this.clearSystemMessages();
                        
                        // Don't add connection message anymore
                        // addMessage('system', '🎉 Đã kết nối!');
                        
                        // 🗑️ ENHANCED: Cleanup old chats when connecting to new person
                        if (previousStrangerId && previousStrangerId !== currentStrangerId) {
                            console.log(`🧹 Scheduling cleanup of old chats with: ${previousStrangerId}`);
                            
                            // Delay 800ms to ensure state sync, then cleanup old chats
                            setTimeout(async () => {
                                try {
                                    console.log(`🗑️ Cleaning up old chats with: ${previousStrangerId}`);
                                    
                                    // Find and delete any old chats with previous stranger
                                    const chatsRef = window.database.ref('chats');
                                    const snapshot = await chatsRef.once('value');
                                    
                                    if (snapshot.exists()) {
                                        const allChats = snapshot.val();
                                        const cleanupPromises = [];
                                        
                                        for (const [chatId, chatData] of Object.entries(allChats)) {
                                            if (chatData.participants && 
                                                chatData.participants[previousStrangerId] && 
                                                chatData.participants[myId] &&
                                                chatId !== this.currentChatId) {
                                                
                                                console.log(`🗑️ Deleting old chat: ${chatId} with ${previousStrangerId}`);
                                                cleanupPromises.push(chatsRef.child(chatId).remove());
                                            }
                                        }
                                        
                                        if (cleanupPromises.length > 0) {
                                            await Promise.all(cleanupPromises);
                                            console.log(`✅ Cleaned up ${cleanupPromises.length} old chats`);
                                        }
                                    }
                                } catch (error) {
                                    console.warn('⚠️ Old chat cleanup failed:', error);
                                }
                            }, 800); // 800ms delay as requested
                        }
                        
                        // Update chat status to active and clear any waiting messages
                        try {
                            await this.chatRef.update({
                                status: 'active',
                                participantCount: 2,
                                lastActivity: firebase.database.ServerValue.TIMESTAMP
                            });
                            
                            // Don't clear messages anymore - keep them for active chat
                            console.log('✅ Chat is now active - messages will be preserved');
                            
                            // Clear all remaining system messages after connection
                            setTimeout(() => {
                                this.clearSystemMessages();
                            }, 100);
                        } catch (error) {
                            console.warn('Failed to update chat status:', error);
                        }
                    }
                    
                } else if (participantCount === 1 && participantIds.includes(myId)) {
                    // ⏳ WAITING STATE: Only me in chat
                    const wasConnected = !!strangerId;
                    
                    console.log(`🔍 Participant state: ${participantCount} participants, wasConnected: ${wasConnected}, strangerId: ${strangerId}`);
                    
                    if (wasConnected) {
                        // Partner just left - keep chat active until both leave
                        console.log('👋 Partner left, keeping chat active');
                        strangerId = null;
                        strangerIdEl.textContent = '';
                        
                        // Show notification that partner left
                        addMessage('system', '👋 Người lạ đã rời đi');
                        
                        // Update connection status to show we're alone but chat is still active
                        updateConnectionStatus('connected', 'Đã kết nối (chờ người khác)');
                        
                        // Don't delete chat - keep it active for the remaining user
                        // Chat will only be deleted when the last person leaves
                        console.log('💬 Chat remains active - waiting for remaining user to leave');
                    } else {
                        // Still waiting for first connection
                        updateConnectionStatus('connecting', 'Đang kết nối...');
                        this.setRandomStrangerAvatar();
                    }
                    
                } else {
                    // 🚨 INVALID STATE
                    console.warn(`⚠️ Invalid state: ${participantCount} participants`);
                    this.handleInvalidState();
                }
                
            }, (error) => {
                console.error('❌ Participant listener error:', error);
                updateConnectionStatus('error', 'Lỗi kết nối');
                setTimeout(() => {
                    this.cleanupLocalState();
                }, 2000);
            });
        }
        
        // Helper: Schedule reconnect with single timeout
        scheduleReconnect() {
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
            }
            
            this.reconnectTimeout = setTimeout(async () => {
                if (!strangerId && this.currentChatId) {
                    console.log('🔄 Auto-reconnect triggered');
                    addMessage('system', '🔍 Tự động tìm người mới...');
                    await this.disconnectChat();
                }
                this.reconnectTimeout = null;
            }, 3000);
        }
        
        // Helper: Set random stranger avatar
        setRandomStrangerAvatar() {
            const randomAvatarIndex = Math.floor(Math.random() * 12) + 1;
            strangerAvatar.src = `${AVATAR_BASE_URL}${randomAvatarIndex}.png`;
        }
        
        // Helper: Clear all system messages from chat
        clearSystemMessages() {
            const systemMessages = chatWindow.querySelectorAll('.msg-content[style*="--bg-system-msg"]');
            systemMessages.forEach(msg => msg.remove());
            console.log(`🧹 Cleared ${systemMessages.length} system messages`);
        }
        
        // Helper: Handle invalid participant states
        handleInvalidState() {
            console.log('🔧 Handling invalid participant state - returning to idle');
            this.cleanupLocalState();
            // Don't auto-start new chat - user must click "Bắt đầu chat"
        }
        
        // Send typing indicator
        sendTyping() {
            if (!this.chatRef) return;
            
            this.chatRef.child('typing').child(myId).set(true);
            setTimeout(() => {
                this.chatRef.child('typing').child(myId).remove();
            }, 3000);
        }
        
        // Listen for typing indicators
        listenForTyping() {
            if (!this.chatRef) return;
            
            this.chatRef.child('typing').on('value', (snapshot) => {
                const typing = snapshot.val();
                const isStrangerTyping = typing && Object.keys(typing).some(id => id !== myId);
                
                if (isStrangerTyping) {
                    showTypingIndicator();
                } else {
                    hideTypingIndicator();
                }
            });
        }
        
        // 🔧 FIXED: Enhanced disconnect with better error handling
        async disconnectChat() {
            console.log('🚪 Disconnect request received');
            
            if (!isFirebaseReady) {
                console.log('⚠️ Firebase not ready, cleanup local state only');
                this.cleanupLocalState();
                chatWindow.innerHTML = '';
                hideTypingIndicator();
                addMessage('system', '🔄 Đã rời chat');
                return;
            }
            
            if (!this.chatRef || !this.currentChatId) {
                console.log('⚠️ No active chat to disconnect from');
                this.cleanupLocalState();
                addMessage('system', '🔄 Đã rời chat');
                return;
            }
            
            const chatId = this.currentChatId;
            console.log(`🗑️ Disconnecting from chat: ${chatId}`);
            
            try {
                // Get current chat state (with timeout)
                const chatSnapshot = await Promise.race([
                    this.chatRef.once('value'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
                
                const chatData = chatSnapshot.val();
                
                if (chatData && chatData.participants) {
                    const participantIds = Object.keys(chatData.participants);
                    const participantCount = participantIds.length;
                    
                    console.log(`📊 Chat has ${participantCount} participants`);
                    
                    if (participantCount <= 1) {
                        // Only me - delete entire chat including messages
                        console.log('🗑️ Deleting single-user chat with all messages');
                        await this.chatRef.remove();
                    } else {
                        // Multiple users - remove myself but keep chat active for others
                        console.log('🚪 Leaving multi-user chat - keeping chat active for remaining users');
                        await Promise.all([
                            this.chatRef.child('participants').child(myId).remove(),
                            this.chatRef.child('typing').child(myId).remove()
                            // Don't delete messages - keep them for remaining users
                        ]);
                    }
                } else {
                    // Chat doesn't exist or no participants
                    console.log('💭 Chat already empty or deleted');
                }
                
                // Remove from waiting queue (with error handling)
                if (this.waitingQueue) {
                    try {
                        await this.waitingQueue.remove();
                        console.log('🧹 Removed from waiting queue');
                    } catch (queueError) {
                        console.warn('⚠️ Queue removal failed:', queueError);
                    }
                }
                
                console.log('✅ Disconnect successful');
                addMessage('system', '👋 Đã rời chat');
                
            } catch (error) {
                console.error('❌ Disconnect error:', error);
                // Don't show error to user - just proceed with cleanup
                addMessage('system', '👋 Đã rời chat');
            }
            
            // Always cleanup local state
            this.cleanupLocalState();
            
            // Clear all messages from chat window when disconnecting
            chatWindow.innerHTML = '';
            hideTypingIndicator();
            
            // Clear any remaining system messages
            this.clearSystemMessages();
            
            // 🧹 ENHANCED: Cleanup any abandoned chats but don't auto-start new chat
            setTimeout(async () => {
                await this.cleanupAbandonedChats();
                console.log('✅ Disconnect complete - user can start new chat when ready');
            }, 500);
        }
        
        // OPTIMIZED: Aggressive chat cleanup - delete immediately when inactive
        setupChatCleanup(chatId) {
            if (!isFirebaseReady) return;
            
            // Clear any existing cleanup timer
            if (this.cleanupTimer) {
                clearTimeout(this.cleanupTimer);
            }
            
                    // Set 10-minute cleanup timer for inactive chats (longer to allow for reconnection)
        this.cleanupTimer = setTimeout(async () => {
            if (this.currentChatId === chatId && this.chatRef) {
                try {
                    console.log('⏰ Auto-cleanup triggered - checking if chat should be deleted');
                    
                    // Check current participant count before deleting
                    const chatSnapshot = await this.chatRef.once('value');
                    const chatData = chatSnapshot.val();
                    
                    if (chatData && chatData.participants) {
                        const participantCount = Object.keys(chatData.participants).length;
                        
                        if (participantCount === 0) {
                            // No participants left - safe to delete
                            console.log('🗑️ Deleting completely empty chat');
                            await this.chatRef.remove();
                            this.cleanupLocalState();
                            addMessage('system', '⏰ Chat không hoạt động đã được xóa');
                        } else {
                            console.log(`💬 Chat still has ${participantCount} participants - keeping active`);
                            // Extend cleanup timer for another 5 minutes
                            this.setupChatCleanup(chatId);
                        }
                    }
                    
                } catch (error) {
                    console.error('Auto cleanup error:', error);
                }
            }
        }, 600000); // 10 minutes instead of 2
        }
        

        
        // Clean up local chat state
        cleanupLocalState() {
            // Clean up Firebase listeners
            if (this.chatRef) {
                this.chatRef.off();
            }
            
            // Clear timers
            if (this.cleanupTimer) {
                clearTimeout(this.cleanupTimer);
                this.cleanupTimer = null;
            }
            
            // Clear all messages from chat window
            if (chatWindow) {
                chatWindow.innerHTML = '';
            }
            
            // Reset state
            this.chatRef = null;
            this.currentChatId = null;
            this.currentPartner = null;
            strangerId = null;
            strangerIdEl.textContent = '';
            strangerAvatar.src = '';
            
            updateConnectionStatus('idle', 'Sẵn sàng để bắt đầu chat!');
        }
        
        // Update last activity timestamp
        updateLastActivity() {
            this.lastActivity = Date.now();
            
            if (this.chatRef) {
                this.chatRef.update({
                    lastActivity: firebase.database.ServerValue.TIMESTAMP
                }).catch(error => {
                    console.error('Error updating last activity:', error);
                });
            }
        }
        
        // Debug function to check chat state and listeners
        debugChatState() {
            console.log('🐛 Chat Debug State:', {
                isFirebaseReady: isFirebaseReady,
                currentChatId: this.currentChatId,
                currentPartner: this.currentPartner,
                hasChatRef: !!this.chatRef,
                hasWaitingQueue: !!this.waitingQueue,
                hasCleanupTimer: !!this.cleanupTimer,
                myId: myId,
                strangerId: strangerId,

                lastActivity: new Date(this.lastActivity).toLocaleString()
            });
            
            if (this.chatRef) {
                this.chatRef.once('value').then((snapshot) => {
                    console.log('🐛 Current chat data:', snapshot.val());
                });
                
                // Check if there are multiple listeners (potential duplicate issue)
                console.log('🐛 Chat ref exists - checking for listeners...');
            }
        }
        
        // OPTIMIZED: Auto-delete chat when user disconnects (closes tab/refreshes)
        setupOnDisconnectDelete() {
            if (!isFirebaseReady || !this.chatRef) return;
            
            console.log('🔧 Setting up auto-delete on disconnect');
            
            // Remove self from participants when disconnected
            this.chatRef.child('participants').child(myId).onDisconnect().remove();
            
            // Also remove typing indicator
            this.chatRef.child('typing').child(myId).onDisconnect().remove();
            
            // The participant listener will handle actual chat deletion when empty
        }
        
        // 🧹 ENHANCED: Cleanup abandoned chats to prevent accumulation
        async cleanupAbandonedChats() {
            if (!isFirebaseReady) return;
            
            try {
                console.log('🧹 Cleaning up abandoned chats...');
                
                const chatsRef = window.database.ref('chats');
                const snapshot = await chatsRef.once('value');
                
                if (!snapshot.exists()) return;
                
                const allChats = snapshot.val();
                const cleanupPromises = [];
                const now = Date.now();
                const tenMinutesAgo = now - (10 * 60 * 1000);
                
                for (const [chatId, chatData] of Object.entries(allChats)) {
                    let shouldDelete = false;
                    
                    // Delete if chat involves me and is old
                    if (chatData.participants && chatData.participants[myId]) {
                        const participantCount = Object.keys(chatData.participants).length;
                        const lastActivity = chatData.lastActivity || chatData.createdAt || 0;
                        
                        // Delete if completely empty, or if single user and very old, or if very old regardless
                        if (participantCount === 0 ||
                            (participantCount === 1 && lastActivity < (now - 20 * 60 * 1000)) || // 20 minutes for single user
                            lastActivity < (now - 45 * 60 * 1000)) { // 45 minutes very old
                            
                            shouldDelete = true;
                            console.log(`🗑️ Deleting abandoned chat: ${chatId} (${participantCount} users, age: ${Math.round((now - lastActivity) / 60000)}min)`);
                        }
                    }
                    
                    if (shouldDelete) {
                        cleanupPromises.push(chatsRef.child(chatId).remove());
                    }
                }
                
                if (cleanupPromises.length > 0) {
                    await Promise.all(cleanupPromises);
                    console.log(`✅ Cleaned up ${cleanupPromises.length} abandoned chats`);
                } else {
                    console.log('💚 No abandoned chats to clean up');
                }
                
            } catch (error) {
                console.warn('⚠️ Abandoned chat cleanup failed:', error);
            }
        }

    }
    
    // Reddit SVG Icons (removed share icon)
    const REDDIT_ICONS = {
        upvote: `<svg fill="currentColor" height="16" viewBox="0 0 20 20" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 19c-.072 0-.145 0-.218-.006A4.1 4.1 0 0 1 6 14.816V11H2.862a1.751 1.751 0 0 1-1.234-2.993L9.41.28a.836.836 0 0 1 1.18 0l7.782 7.727A1.751 1.751 0 0 1 17.139 11H14v3.882a4.134 4.134 0 0 1-.854 2.592A3.99 3.99 0 0 1 10 19Zm0-17.193L2.685 9.071a.251.251 0 0 0 .177.429H7.5v5.316A2.63 2.63 0 0 0 9.864 17.5a2.441 2.441 0 0 0 1.856-.682A2.478 2.478 0 0 0 12.5 15V9.5h4.639a.25.25 0 0 0 .176-.429L10 1.807Z"></path>
        </svg>`,
        downvote: `<svg fill="currentColor" height="16" viewBox="0 0 20 20" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 1c.072 0 .145 0 .218.006A4.1 4.1 0 0 1 14 5.184V9h3.138a1.751 1.751 0 0 1 1.234 2.993L10.59 19.72a.836.836 0 0 1-1.18 0l-7.782-7.727A1.751 1.751 0 0 1 2.861 9H6V5.118a4.134 4.134 0 0 1 .854-2.592A3.99 3.99 0 0 1 10 1Zm0 17.193 7.315-7.264a.251.251 0 0 0-.177-.429H12.5V5.184A2.631 2.631 0 0 0 10.136 2.5a2.441 2.441 0 0 0-1.856.682A2.478 2.478 0 0 0 7.5 5v5.5H2.861a.251.251 0 0 0-.176.429L10 18.193Z"></path>
        </svg>`,
        comment: `<svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 20 20" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 19H1.871a.886.886 0 0 1-.798-.52.886.886 0 0 1 .158-.941L3.1 15.771A9 9 0 1 1 10 19Zm-6.549-1.5H10a7.5 7.5 0 1 0-5.323-2.219l.54.545L3.451 17.5Z"></path>
        </svg>`
    };

    // Avatar system
    const AVATAR_BASE_URL = 'https://raw.githubusercontent.com/diepvantien/file-nhanh/main/avatar/';
    const AVATAR_COUNT = 12; // We have 1.png to 12.png

    function getAvatarUrl(userId) {
        // Check if user has custom avatar selection
        const customAvatar = localStorage.getItem(`customAvatar_${userId}`);
        if (customAvatar) {
            return `${AVATAR_BASE_URL}${customAvatar}.png`;
        }
        
        // Default behavior for auto-generated avatars
        const userIdNum = parseInt(userId);
        const avatarIndex = (userIdNum % AVATAR_COUNT) + 1;
        return `${AVATAR_BASE_URL}${avatarIndex}.png`;
    }

    // Content Filter - Only block links
    const BLOCKED_PATTERNS = {
        urls: /(https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.(com|net|org|edu|gov|vn|xyz|io|me|co|info|biz|tv|ly|tk|ml|ga|cf))/gi
    };

    function containsBlockedContent(text) {
        if (BLOCKED_PATTERNS.urls.test(text)) {
            return { blocked: true, reason: 'link' };
        }
        
        return { blocked: false };
    }

    // Generate stable ID based on browser fingerprint
    function generateStableId() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Browser fingerprint', 2, 2);
        
        const fingerprint = [
            navigator.userAgent,
            navigator.language,
            screen.width + 'x' + screen.height,
            new Date().getTimezoneOffset(),
            canvas.toDataURL()
        ].join('|');
        
        let hash = 0;
        for (let i = 0; i < fingerprint.length; i++) {
            const char = fingerprint.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        const positiveHash = Math.abs(hash);
        const id = String(positiveHash).padStart(8, '0').slice(-8);
        return id;
    }

    // DOM Elements
    const appContainer = document.getElementById('app-container');
    const chatWindow = document.getElementById('chat-window');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const myIdEl = document.getElementById('my-id');
    const strangerIdEl = document.getElementById('stranger-id');
    const myIdContainer = document.getElementById('my-id-container');
    const replyPreviewContainer = document.getElementById('reply-preview-container');
    const replyPreviewText = document.getElementById('reply-preview-text');
    const replyAuthor = document.getElementById('reply-author');
    const replyAvatar = document.getElementById('reply-avatar');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    const onlineCountEl = document.getElementById('online-count');
    const myAvatar = document.getElementById('my-avatar');
    const strangerAvatar = document.getElementById('stranger-avatar');
    const disconnectChatBtn = document.getElementById('disconnect-chat-btn');
    
    // Connection Status Elements
    const connectionStatus = document.getElementById('connection-status');
    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');
    const connectionActionBtn = document.getElementById('connection-action-btn');
    const actionBtnText = document.getElementById('action-btn-text');

    // Navigation Elements
    const chatTab = document.getElementById('chat-tab');
    const feedTab = document.getElementById('feed-tab');
    const chatSection = document.getElementById('chat-section');
    const feedSection = document.getElementById('feed-section');

    // Feed Elements
    const refreshFeedBtn = document.getElementById('refresh-feed-btn');
    const newPostBtn = document.getElementById('new-post-btn');
    const newPostModal = document.getElementById('new-post-modal');
    const closePostModal = document.getElementById('close-post-modal');
    const newPostForm = document.getElementById('new-post-form');
    const postTitle = document.getElementById('post-title');
    const postContent = document.getElementById('post-content');
    const titleCount = document.getElementById('title-count');
    const contentCount = document.getElementById('content-count');
    const cancelPostBtn = document.getElementById('cancel-post-btn');
    const postsContainer = document.getElementById('posts-container');
    const feedLoading = document.getElementById('feed-loading');
    const feedEmpty = document.getElementById('feed-empty');
    const postLimitNotice = document.getElementById('post-limit-notice');
    const postsTodayCount = document.getElementById('posts-today-count');
    const remainingPosts = document.getElementById('remaining-posts');

    // Avatar Picker Elements
    const avatarPickerModal = document.getElementById('avatar-picker-modal');
    const closeAvatarModal = document.getElementById('close-avatar-modal');
    const closeAvatarPickerBtn = document.getElementById('close-avatar-picker-btn');
    const avatarGrid = document.getElementById('avatar-grid');

    // Theme and Mode Elements
    const themeSelectorMobile = document.getElementById('theme-selector-mobile');
    const themeSelectorDesktop = document.getElementById('theme-selector-desktop');
    const darkModeBtn = document.getElementById('dark-mode-btn');
    const fontSwitcher = document.getElementById('font-switcher');
    const darkModeBtnDesktop = document.getElementById('dark-mode-btn-desktop');
    const fontSwitcherDesktop = document.getElementById('font-switcher-desktop');

    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    // App State
    let myId = generateStableId();
    let strangerId;
    let isChatActive = true;
    let replyingTo = null;
    let onlineUsers = Math.floor(Math.random() * (250 - 50 + 1)) + 50;
    let currentTheme = localStorage.getItem(`chatTheme_${myId}`) || 'cute';
    let isDarkMode = localStorage.getItem(`darkMode_${myId}`) === 'enabled';
    let typingTimeout = null;
    let currentTab = 'chat';

    // Feed State
    let posts = [];
    let comments = JSON.parse(localStorage.getItem('postComments') || '{}');
    let userVotes = JSON.parse(localStorage.getItem('userVotes') || '{}');
    let userCommentVotes = JSON.parse(localStorage.getItem('userCommentVotes') || '{}');
    let userPosts = JSON.parse(localStorage.getItem('userPosts') || '{}');
    let expandedPosts = new Set();
    let replyToComment = null;
    let needsRerender = false;

    // Firebase instances
    let firebaseChat = null;
    let feedManager = null;
    
    // Connection status management
    function updateConnectionStatus(status, message) {
        console.log(`🔗 Connection status: ${status} - ${message}`);
        console.log('🔗 DOM Elements availability:', {
            connectionText: !!connectionText,
            connectionDot: !!connectionDot,
            actionBtnText: !!actionBtnText,
            connectionActionBtn: !!connectionActionBtn
        });
        
        if (!connectionText || !connectionDot || !actionBtnText || !connectionActionBtn) {
            console.warn('⚠️ Missing DOM elements for connection status update');
            return;
        }
        
        connectionText.textContent = message;
        connectionDot.className = 'h-2 w-2 rounded-full transition-all';
        connectionActionBtn.className = 'px-3 py-1 text-xs rounded-full transition-all hover:scale-105';
        
        switch (status) {
            case 'initializing':
                connectionDot.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-orange-500', 'animate-pulse', 'hidden');
                connectionDot.classList.add('bg-gray-400');
                actionBtnText.textContent = 'Đang khởi tạo';
                connectionActionBtn.style.backgroundColor = '#6b7280';
                connectionActionBtn.style.color = 'white';
                connectionActionBtn.disabled = true;
                // Disable chat input
                messageInput.disabled = true;
                messageInput.placeholder = "Đang khởi tạo...";
                break;
                
            case 'connecting':
                connectionDot.classList.remove('bg-gray-400', 'bg-green-500', 'bg-orange-500', 'hidden');
                connectionDot.classList.add('bg-yellow-500', 'animate-pulse');
                actionBtnText.textContent = 'Đang kết nối';
                connectionActionBtn.style.backgroundColor = '#eab308';
                connectionActionBtn.style.color = 'white';
                connectionActionBtn.disabled = false;
                // Disable chat input
                messageInput.disabled = true;
                messageInput.placeholder = "Đang tìm người để chat...";
                break;
                
            case 'connected':
                connectionDot.classList.remove('bg-gray-400', 'bg-yellow-500', 'bg-orange-500', 'animate-pulse', 'hidden');
                connectionDot.classList.add('bg-green-500');
                actionBtnText.textContent = 'Rời đoạn chat';
                connectionActionBtn.style.backgroundColor = '#ef4444';
                connectionActionBtn.style.color = 'white';
                connectionActionBtn.disabled = false;
                // Enable chat input
                messageInput.disabled = false;
                messageInput.placeholder = "Nhập tin nhắn...";
                break;
                
            case 'waiting':
                connectionDot.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-gray-400', 'hidden');
                connectionDot.classList.add('bg-orange-500', 'animate-pulse');
                actionBtnText.textContent = 'Tìm người mới';
                connectionActionBtn.style.backgroundColor = '#f97316';
                connectionActionBtn.style.color = 'white';
                connectionActionBtn.disabled = false;
                // Disable chat input
                messageInput.disabled = true;
                messageInput.placeholder = "Người lạ đã rời đi...";
                break;
                
            case 'offline':
                connectionDot.classList.remove('bg-gray-400', 'bg-yellow-500', 'bg-green-500', 'bg-orange-500', 'animate-pulse');
                connectionDot.classList.add('hidden');
                actionBtnText.textContent = 'Offline';
                connectionActionBtn.style.backgroundColor = '#6b7280';
                connectionActionBtn.style.color = 'white';
                connectionActionBtn.disabled = true;
                // Disable chat input
                messageInput.disabled = true;
                messageInput.placeholder = "Chế độ offline - chỉ có posts/comments";
                break;
            case 'idle':
                connectionDot.classList.remove('bg-yellow-500', 'bg-green-500', 'bg-orange-500', 'hidden', 'animate-pulse');
                connectionDot.classList.add('bg-gray-400');
                actionBtnText.textContent = 'Bắt đầu chat';
                connectionActionBtn.style.backgroundColor = '#22c55e'; // green
                connectionActionBtn.style.color = 'white';
                connectionActionBtn.disabled = false;
                messageInput.disabled = true;
                messageInput.placeholder = 'Nhấn "Bắt đầu chat" để tìm người lạ';
                break;
        }
    }
    
    // Handle connection action button click
    function handleConnectionAction() {
        console.log('🔧 Connection action button clicked!');
        console.log('🔧 DOM Elements debug:', {
            connectionActionBtn: !!connectionActionBtn,
            actionBtnText: !!actionBtnText,
            actionBtnTextContent: actionBtnText?.textContent,
            isFirebaseReady: isFirebaseReady,
            firebaseChat: !!firebaseChat
        });
        
        if (!actionBtnText) {
            console.error('❌ actionBtnText element not found!');
            addMessage('system', '❌ UI Error: Button text element missing');
            return;
        }
        
        if (!isFirebaseReady) {
            console.log('❌ Firebase not ready');
            addMessage('system', '📱 Cần Firebase để kết nối chat realtime!');
            return;
        }
        
        const currentStatus = actionBtnText.textContent;
        console.log('🔧 Current status:', currentStatus);
        
        if (currentStatus === 'Đang kết nối') {
            console.log('🔧 Canceling current connection search');
            addMessage('system', '🔄 Đang tìm người mới...');
            if (firebaseChat) {
                firebaseChat.disconnectChat();
                updateConnectionStatus('connecting', 'Đang tìm người mới');
            }
        } else if (currentStatus === 'Rời đoạn chat') {
            if (!confirm('Bạn có chắc chắn muốn rời đoạn chat này không?')) {
                return;
            }
            console.log('🔧 Disconnecting from current partner');
            addMessage('system', '👋 Đang rời đoạn chat...');
            if (firebaseChat && typeof firebaseChat.disconnectChat === 'function') {
                firebaseChat.disconnectChat();
                updateConnectionStatus('connecting', 'Đang kết nối');
            } else {
                console.error('❌ FirebaseChat or disconnectChat not available');
                addMessage('system', '❌ Lỗi kết nối - thử reload trang');
            }
        } else if (currentStatus === 'Tìm người mới') {
            console.log('🔧 Finding new chat partner');
            addMessage('system', '🔍 Đang tìm người mới...');
            if (firebaseChat) {
                firebaseChat.findChat();
                updateConnectionStatus('connecting', 'Đang kết nối');
            }
        } else if (currentStatus === 'Bắt đầu chat') {
            addMessage('system', '🔍 Đang tìm người để chat...');
            if (firebaseChat) {
                firebaseChat.findChat();
                updateConnectionStatus('connecting', 'Đang kết nối');
            }
        } else {
            console.log('🔧 Unknown status:', currentStatus);
            addMessage('system', '🔄 Đang khởi động lại kết nối...');
            if (firebaseChat) {
                firebaseChat.disconnectChat();
            }
        }
    }

    // --- FIREBASE FEED SYSTEM ---
    class FirebaseFeedManager {
        constructor() {
            this.postsRef = null;
            this.commentsRef = null;
            this.votesRef = null;
            this.userPostsRef = null;
        }
        
        async init() {
            if (isFirebaseReady) {
                this.postsRef = window.database.ref('posts');
                this.commentsRef = window.database.ref('comments');
                this.votesRef = window.database.ref('votes');
                this.userPostsRef = window.database.ref('userPosts');
                
                            this.listenForPosts();
            this.listenForComments();
            this.listenForVotes(); // ⚡ ENHANCED: Listen for realtime vote changes
            this.loadSamplePosts();
                
                // Load user votes from Firebase to prevent vote spam
                await this.loadUserVotes();
            } else {
                // Fallback to localStorage only when Firebase is not ready
                this.loadLocalPosts();
            this.loadSamplePosts();
            }
        }
        
        // 📝 ENHANCED: Realtime Firebase posts listeners with instant updates
        listenForPosts() {
            if (!this.postsRef) return;
            
            console.log('📝 Setting up realtime posts listeners...');
            
            // Listen for new posts added
            this.postsRef.on('child_added', (snapshot) => {
                const newPost = { id: snapshot.key, ...snapshot.val() };
                
                // Check if post already exists (avoid duplicates)
                const existingIndex = posts.findIndex(p => p.id === newPost.id);
                if (existingIndex === -1) {
                    // Add new post to beginning of array (most recent first)
                    posts.unshift(newPost);
                    console.log(`📝 New post added: ${newPost.id} by ${newPost.authorId}`);
                    this.renderPosts(); // Instant UI update
                }
            });
            
            // Listen for post updates (votes, etc.)
            this.postsRef.on('child_changed', (snapshot) => {
                const updatedPost = { id: snapshot.key, ...snapshot.val() };
                
                // Update specific post in memory
                const postIndex = posts.findIndex(p => p.id === updatedPost.id);
                if (postIndex !== -1) {
                    posts[postIndex] = updatedPost;
                    console.log(`🔄 Post updated: ${updatedPost.id}`);
                    this.renderPosts(); // Instant UI update
                }
            });
            
            // Listen for post deletions
            this.postsRef.on('child_removed', (snapshot) => {
                const deletedPostId = snapshot.key;
                
                // Remove from local array
                const postIndex = posts.findIndex(p => p.id === deletedPostId);
                if (postIndex !== -1) {
                    posts.splice(postIndex, 1);
                    console.log(`🗑️ Post deleted: ${deletedPostId}`);
                    this.renderPosts(); // Instant UI update
                }
            });
            
            // Initial load
            this.postsRef.once('value', (snapshot) => {
                const firebasePosts = snapshot.val();
                if (firebasePosts) {
                    posts = Object.keys(firebasePosts)
                        .map(key => ({ id: key, ...firebasePosts[key] }))
                        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                        .filter(post => (post.downvotes || 0) - (post.upvotes || 0) <= 5);
                } else {
                    posts = [];
                }
                
                console.log(`📝 Posts loaded: ${posts.length} posts`);
                this.renderPosts();
            });
        }
        
        // 💬 ENHANCED: Realtime comments listeners with instant updates  
        listenForComments() {
            if (!this.commentsRef) return;
            
            console.log('💬 Setting up realtime comments listeners...');
            
            // Listen for new comment threads
            this.commentsRef.on('child_added', (snapshot) => {
                const postId = snapshot.key;
                const postComments = snapshot.val();
                comments[postId] = postComments;
                console.log(`💬 New comments for post: ${postId}`);
                this.renderPosts(); // Update comment counts instantly
            });
            
            // Listen for comment updates (new comments in thread, votes, etc.)
            this.commentsRef.on('child_changed', (snapshot) => {
                const postId = snapshot.key;
                const postComments = snapshot.val();
                comments[postId] = postComments;
                console.log(`🔄 Comments updated for post: ${postId}`);
                
                // Refresh specific post comments if expanded
                if (expandedPosts.has(postId)) {
                    this.refreshComments(postId);
                } else {
                    this.renderPosts(); // Update comment counts
                }
            });
            
            // Listen for comment thread deletions
            this.commentsRef.on('child_removed', (snapshot) => {
                const postId = snapshot.key;
                delete comments[postId];
                console.log(`🗑️ Comments deleted for post: ${postId}`);
                this.renderPosts(); // Update UI instantly
            });
            
            // Initial load
            this.commentsRef.once('value', (snapshot) => {
                const firebaseComments = snapshot.val();
                comments = firebaseComments || {};
                console.log(`💬 Comments loaded: ${Object.keys(comments).length} post threads`);
                this.renderPosts();
            });
        }
        
        // ⚡ ENHANCED: Listen for realtime vote changes from other users
        listenForVotes() {
            if (!isFirebaseReady || !this.votesRef) return;
            
            // Listen for post vote changes
            this.votesRef.child('posts').on('child_changed', (snapshot) => {
                const voteKey = snapshot.key;
                const voteValue = snapshot.val();
                
                // Extract postId from voteKey format: userId_postId
                const parts = voteKey.split('_');
                if (parts.length >= 2) {
                    const postId = parts.slice(1).join('_'); // Handle postIds with underscores
                    
                    // Update UI if this post is currently visible
                    this.refreshPostVoteDisplay(postId);
                }
            });
            
            this.votesRef.child('posts').on('child_removed', (snapshot) => {
                const voteKey = snapshot.key;
                const parts = voteKey.split('_');
                if (parts.length >= 2) {
                    const postId = parts.slice(1).join('_');
                    this.refreshPostVoteDisplay(postId);
                }
            });
            
            // Listen for comment vote changes
            this.votesRef.child('comments').on('child_changed', (snapshot) => {
                const voteKey = snapshot.key;
                const parts = voteKey.split('_');
                if (parts.length >= 2) {
                    const commentId = parts.slice(1).join('_');
                    this.refreshCommentVoteDisplay(commentId);
                }
            });
            
            this.votesRef.child('comments').on('child_removed', (snapshot) => {
                const voteKey = snapshot.key;
                const parts = voteKey.split('_');
                if (parts.length >= 2) {
                    const commentId = parts.slice(1).join('_');
                    this.refreshCommentVoteDisplay(commentId);
                }
            });
            
            console.log('⚡ Realtime vote listeners activated');
        }
        
        // Refresh post vote display when votes change
        refreshPostVoteDisplay(postId) {
            if (!this.postsRef) return;
            
            // Get updated post data from Firebase
            this.postsRef.child(postId).once('value').then((snapshot) => {
                const updatedPost = snapshot.val();
                if (!updatedPost) return;
                
                // Update local posts array
                const postIndex = posts.findIndex(p => p.id === postId);
                if (postIndex >= 0) {
                    posts[postIndex].upvotes = updatedPost.upvotes || 0;
                    posts[postIndex].downvotes = updatedPost.downvotes || 0;
                    
                    // Update DOM
                    const postEl = document.querySelector(`[data-post-id="${postId}"]`);
                    if (postEl) {
                        this.updateVoteDisplay(postEl, postId);
                    }
                }
            });
        }
        
        // Refresh comment vote display when votes change
        refreshCommentVoteDisplay(commentId) {
            // Find which post this comment belongs to
            for (const [postId, postComments] of Object.entries(comments)) {
                const comment = postComments?.find?.(c => c.id === commentId);
                if (comment && this.commentsRef) {
                    // Get updated comment data
                    this.commentsRef.child(postId).child(commentId).once('value').then((snapshot) => {
                        const updatedComment = snapshot.val();
                        if (!updatedComment) return;
                        
                        // Update local comments
                        comment.upvotes = updatedComment.upvotes || 0;
                        comment.downvotes = updatedComment.downvotes || 0;
                        
                        // Refresh comments display
                        this.refreshComments(postId);
                    });
                    break;
                }
            }
        }
        
        // Fallback methods for offline mode
        loadLocalPosts() {
            const savedPosts = localStorage.getItem('communityPosts');
            if (savedPosts) {
                posts = JSON.parse(savedPosts);
                posts = posts.filter(post => (post.downvotes || 0) - (post.upvotes || 0) <= 5);
                this.saveLocalPosts();
            }
        }

        saveLocalPosts() {
            localStorage.setItem('communityPosts', JSON.stringify(posts));
        }

        saveLocalComments() {
            localStorage.setItem('postComments', JSON.stringify(comments));
        }

        loadSamplePosts() {
            // No sample posts - clean start for real users
            if (!isFirebaseReady) {
                posts = [];
                comments = {};
            }
        }

        // Load user votes from Firebase to prevent vote spam after refresh
        async loadUserVotes() {
            if (!isFirebaseReady || !this.votesRef) return;
            
            try {
                // Load post votes for current user
                const postVotesSnapshot = await this.votesRef.child('posts').orderByKey().startAt(`${myId}_`).endAt(`${myId}_\uf8ff`).once('value');
                const postVotes = postVotesSnapshot.val() || {};
                
                // Load comment votes for current user
                const commentVotesSnapshot = await this.votesRef.child('comments').orderByKey().startAt(`${myId}_`).endAt(`${myId}_\uf8ff`).once('value');
                const commentVotes = commentVotesSnapshot.val() || {};
                
                // Update global vote objects
                Object.keys(postVotes).forEach(key => {
                    userVotes[key] = postVotes[key];
                });
                
                Object.keys(commentVotes).forEach(key => {
                    userCommentVotes[key] = commentVotes[key];
                });
                
                console.log(`🗳️ Loaded ${Object.keys(postVotes).length} post votes and ${Object.keys(commentVotes).length} comment votes from Firebase`);
            } catch (error) {
                console.error('❌ Failed to load user votes:', error);
            }
        }

        async getTodayPostCount(userId) {
            const today = new Date().toDateString();
            
            if (isFirebaseReady && this.userPostsRef) {
                const snapshot = await this.userPostsRef.child(userId).child(today).once('value');
                return snapshot.val() || 0;
            } else if (!isFirebaseReady) {
            const userPostsToday = userPosts[userId] || {};
            return userPostsToday[today] || 0;
            } else {
                throw new Error('Firebase is ready but refs are not initialized');
            }
        }

        async canUserPost(userId) {
            const count = await this.getTodayPostCount(userId);
            return count < 5;
        }

        // 📝 ENHANCED: Create post with instant UI feedback
        async createPost(title, content, authorId) {
            const contentCheck = containsBlockedContent(title + ' ' + content);
            if (contentCheck.blocked) {
                throw new Error('Không được đăng link');
            }

            if (!await this.canUserPost(authorId)) {
                throw new Error('Bạn đã đăng đủ 5 bài hôm nay!');
            }

            const post = {
                authorId: authorId,
                title: title.trim(),
                content: content.trim(),
                timestamp: Date.now(), // Use current time for instant display
                upvotes: 0,
                downvotes: 0,
                avatar: getAvatarUrl(authorId)
            };

            if (isFirebaseReady && this.postsRef) {
                // Create temporary ID for instant UI update
                const tempId = `temp_${Date.now()}_${Math.random()}`;
                const tempPost = { ...post, id: tempId };
                
                // INSTANT UI UPDATE - Add to local array first
                posts.unshift(tempPost);
                this.renderPosts(); // Show immediately
                
                try {
                    // Save to Firebase with server timestamp
                    const postWithServerTime = {
                        ...post,
                        timestamp: firebase.database.ServerValue.TIMESTAMP
                    };
                    const postRef = this.postsRef.push();
                    await postRef.set(postWithServerTime);
                    
                    // Replace temp post with real post (Firebase listener will handle this)
                    const tempIndex = posts.findIndex(p => p.id === tempId);
                    if (tempIndex !== -1) {
                        posts.splice(tempIndex, 1); // Remove temp, let listener add real one
                    }
                    
                    console.log(`📝 Post created: ${postRef.key}`);
                    
                    // Update user post count
                    const today = new Date().toDateString();
                    const userPostRef = this.userPostsRef.child(authorId).child(today);
                    const snapshot = await userPostRef.once('value');
                    const currentCount = snapshot.val() || 0;
                    await userPostRef.set(currentCount + 1);
                    
                } catch (error) {
                    console.error('Error creating post:', error);
                    
                    // ROLLBACK - Remove temp post on error
                    const tempIndex = posts.findIndex(p => p.id === tempId);
                    if (tempIndex !== -1) {
                        posts.splice(tempIndex, 1);
                        this.renderPosts();
                    }
                    
                    throw new Error('Lỗi tạo bài đăng! Thử lại sau.');
                }
            } else {
                // Offline mode - localStorage fallback
                if (!isFirebaseReady) {
                    post.id = Date.now().toString();
            posts.unshift(post);
                    this.saveLocalPosts();
                    this.renderPosts(); // Instant UI update

            const today = new Date().toDateString();
            if (!userPosts[authorId]) userPosts[authorId] = {};
            userPosts[authorId][today] = (userPosts[authorId][today] || 0) + 1;
            localStorage.setItem('userPosts', JSON.stringify(userPosts));
                } else {
                    throw new Error('Firebase is ready but refs are not initialized');
                }
            }

            return true;
        }

        async addComment(postId, content, authorId, replyToId = null) {
            const contentCheck = containsBlockedContent(content);
            if (contentCheck.blocked) {
                throw new Error('Không được đăng link');
            }

            const comment = {
                authorId: authorId,
                content: content.trim(),
                timestamp: isFirebaseReady ? firebase.database.ServerValue.TIMESTAMP : Date.now(),
                upvotes: 0,
                downvotes: 0,
                replyTo: replyToId,
                avatar: getAvatarUrl(authorId)
            };

            if (isFirebaseReady && this.commentsRef) {
                // Save to Firebase
                const commentRef = this.commentsRef.child(postId).push();
                await commentRef.set(comment);
                comment.id = commentRef.key;
            } else {
                // Only fallback to localStorage when Firebase is not ready
                if (!isFirebaseReady) {
                    comment.id = Date.now().toString();
                    comment.timestamp = Date.now();
            if (!comments[postId]) {
                comments[postId] = [];
            }
            comments[postId].push(comment);
                    this.saveLocalComments();
                } else {
                    throw new Error('Firebase is ready but refs are not initialized');
                }
            }

            return comment;
        }

        async vote(postId, voteType, userId, isComment = false, commentId = null) {
            if (isComment) {
                return this.voteComment(postId, commentId, voteType, userId);
            }

            // Find post in memory for immediate UI update
            const post = posts.find(p => p.id === postId);
            if (!post) {
                console.error('Post not found:', postId);
                return false;
            }

            const voteKey = `${userId}_${postId}`;
            const previousVote = this.getUserVote(postId, userId);

            // Calculate new vote counts for immediate UI update
            let newUpvotes = post.upvotes || 0;
            let newDownvotes = post.downvotes || 0;
            
            // Remove previous vote
            if (previousVote === 'up') {
                newUpvotes = Math.max(0, newUpvotes - 1);
            } else if (previousVote === 'down') {
                newDownvotes = Math.max(0, newDownvotes - 1);
            }

            let newVote = null;
            // Apply new vote or remove if same
            if (previousVote === voteType) {
                // Remove vote (already subtracted above)
                newVote = null;
            } else {
                // Add new vote
                newVote = voteType;
                if (voteType === 'up') {
                    newUpvotes += 1;
                } else {
                    newDownvotes += 1;
                }
            }

            // IMMEDIATE UI UPDATE (optimistic)
            post.upvotes = newUpvotes;
            post.downvotes = newDownvotes;
            
            // Update vote state immediately
            if (newVote) {
                userVotes[voteKey] = newVote;
            } else {
                delete userVotes[voteKey];
            }
            
            // Re-render immediately for instant feedback
            this.updateVoteDisplay(document.querySelector(`[data-post-id="${postId}"]`), postId);

            // SYNC WITH BACKEND
            if (isFirebaseReady && this.postsRef && this.votesRef) {
                try {
                    // Firebase voting
                    const voteRef = this.votesRef.child('posts').child(voteKey);
                    const postRef = this.postsRef.child(postId);
                    
                    // Update vote record
                    if (newVote) {
                        await voteRef.set(newVote);
                    } else {
                        await voteRef.remove();
                    }
                    
                    // Update post vote counts atomically
                    await postRef.update({
                        upvotes: newUpvotes,
                        downvotes: newDownvotes,
                        lastActivity: firebase.database.ServerValue.TIMESTAMP
                    });
                    
                    console.log(`🗳️ Vote synced: ${postId} (${voteType})`);
                    
                } catch (error) {
                    console.error('Error syncing vote:', error);
                    
                    // ROLLBACK on error
                    post.upvotes = (post.upvotes || 0) - (newUpvotes - (post.upvotes || 0));
                    post.downvotes = (post.downvotes || 0) - (newDownvotes - (post.downvotes || 0));
                    
                    // Restore previous vote state
                    if (previousVote) {
                        userVotes[voteKey] = previousVote;
                    } else {
                        delete userVotes[voteKey];
                    }
                    
                    this.updateVoteDisplay(document.querySelector(`[data-post-id="${postId}"]`), postId);
                    return false;
                }
            } else if (!isFirebaseReady) {
                // Only fallback to localStorage when Firebase is not ready
                this.saveLocalPosts();
            localStorage.setItem('userVotes', JSON.stringify(userVotes));
            } else {
                console.error('Firebase is ready but refs are not initialized');
                return false;
            }
            
            return true;
        }

        async voteComment(postId, commentId, voteType, userId) {
            // Find comment in memory for immediate UI update
            if (!comments[postId]) {
                console.error('Post comments not found:', postId);
                return false;
            }
            
            const postComments = this.getPostComments(postId);
            const comment = postComments.find(c => c.id === commentId);
            if (!comment) {
                console.error('Comment not found:', commentId);
                return false;
            }

            const voteKey = `${userId}_${commentId}`;
            const previousVote = this.getUserVote(postId, userId, true, commentId);

            // Calculate new vote counts for immediate UI update
            let newUpvotes = comment.upvotes || 0;
            let newDownvotes = comment.downvotes || 0;
            
            // Remove previous vote
            if (previousVote === 'up') {
                newUpvotes = Math.max(0, newUpvotes - 1);
            } else if (previousVote === 'down') {
                newDownvotes = Math.max(0, newDownvotes - 1);
            }

            let newVote = null;
            // Apply new vote or remove if same
            if (previousVote === voteType) {
                newVote = null;
            } else {
                newVote = voteType;
                if (voteType === 'up') {
                    newUpvotes += 1;
                } else {
                    newDownvotes += 1;
                }
            }

            // IMMEDIATE UI UPDATE (optimistic)
            comment.upvotes = newUpvotes;
            comment.downvotes = newDownvotes;
            
            // Update vote state immediately
            if (newVote) {
                userCommentVotes[voteKey] = newVote;
            } else {
                delete userCommentVotes[voteKey];
            }
            
            // Re-render comments immediately for instant feedback
            this.refreshComments(postId);

            // SYNC WITH BACKEND
            if (isFirebaseReady && this.commentsRef && this.votesRef) {
                try {
                    // Firebase comment voting
                    const voteRef = this.votesRef.child('comments').child(voteKey);
                    const commentRef = this.commentsRef.child(postId).child(commentId);
                    
                    // Update vote record
                    if (newVote) {
                        await voteRef.set(newVote);
                    } else {
                        await voteRef.remove();
                    }
                    
                    // Update comment vote counts
                    await commentRef.update({
                        upvotes: newUpvotes,
                        downvotes: newDownvotes
                    });
                    
                    console.log(`🗳️ Comment vote synced: ${commentId} (${voteType})`);
                    return true;
                    
                } catch (error) {
                    console.error('Error syncing comment vote:', error);
                    
                    // ROLLBACK on error
                    comment.upvotes = (comment.upvotes || 0) - (newUpvotes - (comment.upvotes || 0));
                    comment.downvotes = (comment.downvotes || 0) - (newDownvotes - (comment.downvotes || 0));
                    
                    // Restore previous vote state
                    if (previousVote) {
                        userCommentVotes[voteKey] = previousVote;
                    } else {
                        delete userCommentVotes[voteKey];
                    }
                    
                    this.refreshComments(postId);
                    return false;
                }
            } else if (!isFirebaseReady) {
                // Fallback to localStorage only when Firebase is not ready
            this.saveComments();
            localStorage.setItem('userCommentVotes', JSON.stringify(userCommentVotes));
            return true;
            } else {
                console.error('Firebase is ready but refs are not initialized');
                return false;
            }
        }

        getUserVote(postId, userId, isComment = false, commentId = null) {
            if (isComment) {
                return userCommentVotes[`${userId}_${commentId}`] || null;
            }
            return userVotes[`${userId}_${postId}`] || null;
        }

        getSortedPosts() {
            return posts.sort((a, b) => {
                const scoreA = a.upvotes - a.downvotes;
                const scoreB = b.upvotes - b.downvotes;
                if (scoreA !== scoreB) {
                    return scoreB - scoreA;
                }
                return b.timestamp - a.timestamp;
            });
        }

        getPostComments(postId) {
            const postCommentsData = comments[postId];
            if (!postCommentsData) return [];
            
            // Convert Firebase object to array if needed
            let postComments;
            if (Array.isArray(postCommentsData)) {
                postComments = postCommentsData;
            } else {
                // Firebase returns object, convert to array
                postComments = Object.keys(postCommentsData).map(key => ({
                    id: key,
                    ...postCommentsData[key]
                }));
            }
            
            return postComments.sort((a, b) => {
                const scoreA = (a.upvotes || 0) - (a.downvotes || 0);
                const scoreB = (b.upvotes || 0) - (b.downvotes || 0);
                if (scoreA !== scoreB) {
                    return scoreB - scoreA;
                }
                return (a.timestamp || 0) - (b.timestamp || 0);
            });
        }

        formatTime(timestamp) {
            const now = Date.now();
            const diff = now - timestamp;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (minutes < 1) return 'vừa xong';
            if (minutes < 60) return `${minutes} phút trước`;
            if (hours < 24) return `${hours} giờ trước`;
            return `${days} ngày trước`;
        }

        renderPosts() {
            if (!needsRerender && postsContainer.children.length > 0) {
                return;
            }

            const sortedPosts = this.getSortedPosts();
            postsContainer.innerHTML = '';

            if (sortedPosts.length === 0) {
                feedEmpty.classList.remove('hidden');
                feedLoading.classList.add('hidden');
                return;
            }

            feedEmpty.classList.add('hidden');
            feedLoading.classList.add('hidden');

            sortedPosts.forEach(post => {
                const postEl = this.createPostElement(post);
                postsContainer.appendChild(postEl);
            });

            needsRerender = false;
        }

        createPostElement(post) {
            const userVote = this.getUserVote(post.id, myId);
            const score = post.upvotes - post.downvotes;
            const commentCount = this.getPostComments(post.id).length;
            const isExpanded = expandedPosts.has(post.id);
            const authorAvatar = getAvatarUrl(post.authorId);
            
            // Check if post content is long (more than 4 lines or 300 characters)
            const contentLines = post.content.split('\n').length;
            const contentLength = post.content.length;
            const isLongPost = this.isPostContentLong(post.content);
            const isPostExpanded = expandedPosts.has(`post-content-${post.id}`);
            
            const postEl = document.createElement('div');
            postEl.className = 'post-card';
            postEl.setAttribute('data-post-id', post.id);
            postEl.innerHTML = `
                <div class="post-main">
                    <div class="post-votes">
                        <button class="vote-btn upvote-btn ${userVote === 'up' ? 'voted' : ''}" data-post-id="${post.id}" data-vote="up" title="Upvote">
                            ${REDDIT_ICONS.upvote}
                        </button>
                        <div class="vote-count ${score > 0 ? 'positive' : score < 0 ? 'negative' : ''}">${score}</div>
                        <button class="vote-btn downvote-btn ${userVote === 'down' ? 'voted' : ''}" data-post-id="${post.id}" data-vote="down" title="Downvote">
                            ${REDDIT_ICONS.downvote}
                        </button>
                    </div>
                    <div class="post-content-wrapper">
                        <div class="post-header">
                            <div class="flex items-center space-x-2">
                                <img src="${authorAvatar}" alt="Avatar" class="avatar-square w-6 h-6">
                                <span class="post-author font-semibold text-sm font-mono">ID: ${post.authorId}</span>
                            </div>
                            <div class="flex items-center space-x-2">
                            <span class="post-time">${this.formatTime(post.timestamp)}</span>
                                ${post.authorId === myId ? `
                                    <button class="delete-post-btn" data-post-id="${post.id}" data-author-id="${post.authorId}" title="Xóa bài đăng">
                                        🗑️
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                        <h3 class="post-title">${this.escapeHtml(post.title)}</h3>
                        <div class="post-text-wrapper">
                            <div class="post-text ${isLongPost && !isPostExpanded ? 'post-text-truncated' : ''}" data-post-id="${post.id}">${this.escapeHtml(post.content.split('\n').map(line => line.replace(/^\s+/, '')).join('\n').trim())}</div>
                            ${isLongPost ? `
                                <button class="read-more-btn" data-post-id="${post.id}" data-action="${isPostExpanded ? 'collapse' : 'expand'}">
                                    ${isPostExpanded ? '← Thu gọn' : 'Xem thêm...'}
                                </button>
                            ` : ''}
                        </div>
                        <div class="post-actions">
                            <button class="action-btn toggle-comments-btn" data-post-id="${post.id}">
                                ${REDDIT_ICONS.comment} ${commentCount} bình luận
                            </button>
                        </div>
                    </div>
                </div>
                <div class="comments-section ${isExpanded ? '' : 'hidden'}" id="comments-${post.id}">
                    <div class="comment-form">
                        <div class="comment-input-wrapper">
                            <textarea class="comment-input" placeholder="Viết bình luận..." maxlength="200" data-post-id="${post.id}" rows="2"></textarea>
                            <button class="comment-submit" data-post-id="${post.id}">Bình luận</button>
                        </div>
                    </div>
                    <div class="comments-list" id="comments-list-${post.id}">
                        ${isExpanded ? this.renderCommentsHtml(post.id) : ''}
                    </div>
                </div>
            `;

            this.attachPostEventListeners(postEl, post);
            return postEl;
        }

        renderCommentsHtml(postId) {
            const postComments = this.getPostComments(postId);
            if (postComments.length === 0) {
                return '<div class="empty-comments"><div class="empty-text">Chưa có bình luận nào. Hãy là người đầu tiên!</div></div>';
            }

            const topLevelComments = postComments.filter(c => !c.replyTo);
            const replies = postComments.filter(c => c.replyTo);
            
            let html = '';
            
            topLevelComments.forEach(comment => {
                html += this.createCommentHtml(comment, postId);
                
                const commentReplies = replies.filter(r => r.replyTo === comment.id);
                if (commentReplies.length > 0) {
                    html += '<div class="comment-replies">';
                    commentReplies.forEach(reply => {
                        html += this.createCommentHtml(reply, postId, true);
                    });
                    html += '</div>';
                }
            });

            return html;
        }

        createCommentHtml(comment, postId, isReply = false) {
            const userVote = this.getUserVote(postId, myId, true, comment.id);
            const score = comment.upvotes - comment.downvotes;
            const authorAvatar = getAvatarUrl(comment.authorId);
            const replyClass = isReply ? 'comment-reply' : '';
            
            return `
                <div class="comment-item ${replyClass}" data-comment-id="${comment.id}">
                    <div class="comment-votes">
                        <button class="comment-vote-btn comment-upvote-btn ${userVote === 'up' ? 'voted' : ''}" data-post-id="${postId}" data-comment-id="${comment.id}" data-vote="up" title="Upvote comment">
                            ${REDDIT_ICONS.upvote}
                        </button>
                        <div class="comment-vote-count ${score > 0 ? 'positive' : score < 0 ? 'negative' : ''}">${score}</div>
                        <button class="comment-vote-btn comment-downvote-btn ${userVote === 'down' ? 'voted' : ''}" data-post-id="${postId}" data-comment-id="${comment.id}" data-vote="down" title="Downvote comment">
                            ${REDDIT_ICONS.downvote}
                        </button>
                    </div>
                    <div class="comment-content-wrapper">
                        <div class="comment-header">
                            <div class="flex items-center space-x-2">
                                <img src="${authorAvatar}" alt="Avatar" class="avatar-square w-4 h-4">
                                <span class="comment-author font-semibold text-xs font-mono">ID: ${comment.authorId}</span>
                            </div>
                            <span class="comment-time">${this.formatTime(comment.timestamp)}</span>
                        </div>
                        <div class="comment-text">${this.escapeHtml(comment.content)}</div>
                        <div class="comment-actions">
                            ${!isReply ? `<button class="comment-action-btn reply-btn" data-comment-id="${comment.id}" data-author-id="${comment.authorId}">Trả lời</button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        attachPostEventListeners(postEl, post) {
            const upvoteBtn = postEl.querySelector('.upvote-btn');
            const downvoteBtn = postEl.querySelector('.downvote-btn');
            
            upvoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.vote(post.id, 'up', myId);
                this.updateVoteDisplay(postEl, post.id);
            });

            downvoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.vote(post.id, 'down', myId);
                this.updateVoteDisplay(postEl, post.id);
            });

            const toggleBtn = postEl.querySelector('.toggle-comments-btn');
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleComments(post.id);
            });

            const commentSubmit = postEl.querySelector('.comment-submit');
            const commentInput = postEl.querySelector('.comment-input');
            
            commentSubmit.addEventListener('click', () => {
                this.submitComment(post.id, commentInput);
            });

            commentInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.submitComment(post.id, commentInput);
                }
            });

            postEl.querySelectorAll('.comment-vote-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const postId = e.target.closest('.comment-vote-btn').dataset.postId;
                    const commentId = e.target.closest('.comment-vote-btn').dataset.commentId;
                    const voteType = e.target.closest('.comment-vote-btn').dataset.vote;
                    
                    this.vote(postId, voteType, myId, true, commentId);
                    this.refreshComments(postId);
                });
            });

            postEl.querySelectorAll('.reply-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const commentId = e.target.dataset.commentId;
                    const authorId = e.target.dataset.authorId;
                    this.startCommentReply(post.id, commentId, authorId);
                });
            });

            const postTitle = postEl.querySelector('.post-title');
            postTitle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleComments(post.id);
            });
            
            const deleteBtn = postEl.querySelector('.delete-post-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const postId = e.target.dataset.postId;
                        const authorId = e.target.dataset.authorId;
                        await this.deletePost(postId, authorId);
                    } catch (error) {
                        console.error('Delete post error:', error);
                        // Silent fail - no popup to avoid annoying users
                    }
                });
            }

            // Handle read more button
            const readMoreBtn = postEl.querySelector('.read-more-btn');
            if (readMoreBtn) {
                readMoreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const postId = e.target.dataset.postId;
                    const action = e.target.dataset.action;
                    const postText = postEl.querySelector('.post-text');
                    
                    if (action === 'expand') {
                        // Expand the post
                        postText.classList.remove('post-text-truncated');
                        expandedPosts.add(`post-content-${postId}`);
                        e.target.textContent = '← Thu gọn';
                        e.target.dataset.action = 'collapse';
                    } else {
                        // Collapse the post
                        postText.classList.add('post-text-truncated');
                        expandedPosts.delete(`post-content-${postId}`);
                        e.target.textContent = 'Xem thêm...';
                        e.target.dataset.action = 'expand';
                    }
                });
            }
        }

        updateVoteDisplay(postEl, postId) {
            const post = posts.find(p => p.id === postId);
            if (!post) return;

            const score = post.upvotes - post.downvotes;
            const voteCountEl = postEl.querySelector('.vote-count');
            const upvoteBtn = postEl.querySelector('.upvote-btn');
            const downvoteBtn = postEl.querySelector('.downvote-btn');
            const userVote = this.getUserVote(postId, myId);

            voteCountEl.textContent = score;
            voteCountEl.className = `vote-count ${score > 0 ? 'positive' : score < 0 ? 'negative' : ''}`;

            upvoteBtn.classList.toggle('voted', userVote === 'up');
            downvoteBtn.classList.toggle('voted', userVote === 'down');
        }

        startCommentReply(postId, commentId, authorId) {
            replyToComment = { postId, commentId, authorId };
            const commentInput = document.querySelector(`#comments-${postId} .comment-input`);
            
            if (commentInput) {
                commentInput.placeholder = `Trả lời u/${authorId}...`;
                commentInput.focus();
                
                const mention = `@u/${authorId} `;
                commentInput.value = mention;
                commentInput.setSelectionRange(mention.length, mention.length);
            }
        }

        toggleComments(postId) {
            if (expandedPosts.has(postId)) {
                expandedPosts.delete(postId);
            } else {
                expandedPosts.add(postId);
            }
            
            const commentsSection = document.getElementById(`comments-${postId}`);
            const commentsList = document.getElementById(`comments-list-${postId}`);
            
            if (expandedPosts.has(postId)) {
                commentsSection.classList.remove('hidden');
                commentsList.innerHTML = this.renderCommentsHtml(postId);
                this.attachCommentEventListeners(commentsList, postId);
                
                const commentInput = commentsSection.querySelector('.comment-input');
                setTimeout(() => commentInput.focus(), 100);
            } else {
                commentsSection.classList.add('hidden');
                replyToComment = null;
            }
        }

        submitComment(postId, inputEl) {
            const content = inputEl.value.trim();
            
            if (!content) {
                alert('⚠️ Vui lòng nhập nội dung bình luận!');
                return;
            }
            
            if (content.length > 200) {
                alert('⚠️ Bình luận quá dài!');
                return;
            }
            
            try {
                const replyToId = replyToComment && replyToComment.postId === postId ? replyToComment.commentId : null;
                this.addComment(postId, content, myId, replyToId);
                inputEl.value = '';
                inputEl.placeholder = 'Viết bình luận...';
                replyToComment = null;
                this.refreshComments(postId);
                this.updateCommentCount(postId);
            } catch (error) {
                alert('⚠️ ' + error.message);
            }
        }

        updateCommentCount(postId) {
            const commentCount = this.getPostComments(postId).length;
            const postEl = document.querySelector(`[data-post-id="${postId}"]`).closest('.post-card');
            const commentBtn = postEl.querySelector('.toggle-comments-btn');
            
            if (commentBtn) {
                commentBtn.innerHTML = `${REDDIT_ICONS.comment} ${commentCount} bình luận`;
            }
        }

        refreshComments(postId) {
            const commentsList = document.getElementById(`comments-list-${postId}`);
            if (commentsList) {
                commentsList.innerHTML = this.renderCommentsHtml(postId);
                this.attachCommentEventListeners(commentsList, postId);
            }
        }

        attachCommentEventListeners(commentsList, postId) {
            commentsList.querySelectorAll('.comment-vote-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const commentId = e.target.closest('.comment-vote-btn').dataset.commentId;
                    const voteType = e.target.closest('.comment-vote-btn').dataset.vote;
                    
                    // Vote function now handles UI update automatically
                    this.vote(postId, voteType, myId, true, commentId);
                });
            });

            commentsList.querySelectorAll('.reply-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const commentId = e.target.dataset.commentId;
                    const authorId = e.target.dataset.authorId;
                    this.startCommentReply(postId, commentId, authorId);
                });
            });
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        isPostContentLong(content) {
            if (!content) return false;
            
            // Check line count
            const lines = content.split('\n').length;
            if (lines > 4) return true;
            
            // Check character count
            if (content.length > 300) return true;
            
            // Check if content has long words that might cause overflow
            const words = content.split(/\s+/);
            const longWords = words.filter(word => word.length > 20);
            if (longWords.length > 0) return true;
            
            // Check if content has many consecutive spaces or special characters
            const specialChars = (content.match(/[^\w\s]/g) || []).length;
            if (specialChars > content.length * 0.3) return true;
            
            return false;
        }
        
        // Delete post (only by author)
        async deletePost(postId, authorId) {
            if (authorId !== myId) {
                throw new Error('Bạn chỉ có thể xóa bài đăng của chính mình!');
            }
            
            if (!confirm('🗑️ Bạn có chắc chắn muốn xóa bài đăng này không?')) {
                return false;
            }
            
            // IMMEDIATE UI UPDATE - Remove from local array first for instant feedback
            const postIndex = posts.findIndex(p => p.id === postId);
            let deletedPost = null;
            if (postIndex !== -1) {
                deletedPost = posts.splice(postIndex, 1)[0];
                this.renderPosts(); // Instant UI update
            }
            
            try {
                if (isFirebaseReady && this.postsRef) {
                    // Delete from Firebase
                    await this.postsRef.child(postId).remove();
                    
                    // Delete comments associated with this post
                    if (this.commentsRef) {
                        await this.commentsRef.child(postId).remove();
                    }
                    
                    // Delete votes associated with this post
                    if (this.votesRef) {
                        // Xoá vote cho post
                        const postVotesSnap = await this.votesRef.child('posts').once('value');
                        const postVotes = postVotesSnap.val() || {};
                        for (const key in postVotes) {
                            if (key.endsWith(`_${postId}`)) {
                                await this.votesRef.child('posts').child(key).remove();
                            }
                        }
                        // Xoá vote cho comment
                        const commentVotesSnap = await this.votesRef.child('comments').once('value');
                        const commentVotes = commentVotesSnap.val() || {};
                        // Lấy tất cả commentId của post này
                        let commentIds = [];
                        if (this.commentsRef) {
                            const commentsSnap = await this.commentsRef.child(postId).once('value');
                            const commentsObj = commentsSnap.val() || {};
                            commentIds = Object.keys(commentsObj);
                        }
                        for (const key in commentVotes) {
                            for (const commentId of commentIds) {
                                if (key.endsWith(`_${commentId}`)) {
                                    await this.votesRef.child('comments').child(key).remove();
                                }
                            }
                        }
                    }
                    console.log(`🗑️ Post, comments, and votes deleted from Firebase: ${postId}`);
                } else {
                    // Clean up localStorage (post already removed from array above)
                    this.saveLocalPosts();
                    // Remove from comments
                    if (comments[postId]) {
                        delete comments[postId];
                        this.saveLocalComments();
                    }
                    // Remove votes for post
                    Object.keys(userVotes).forEach(key => {
                        if (key.endsWith(`_${postId}`)) {
                            delete userVotes[key];
                        }
                    });
                    localStorage.setItem('userVotes', JSON.stringify(userVotes));
                    // Remove votes for comments
                    if (comments[postId]) {
                        const commentIds = comments[postId].map(c => c.id);
                        Object.keys(userCommentVotes).forEach(key => {
                            for (const commentId of commentIds) {
                                if (key.endsWith(`_${commentId}`)) {
                                    delete userCommentVotes[key];
                                }
                            }
                        });
                        localStorage.setItem('userCommentVotes', JSON.stringify(userCommentVotes));
                    }
                    console.log(`🗑️ Post, comments, and votes deleted locally: ${postId}`);
                }
                return true;
            } catch (e) {
                alert('Lỗi khi xoá bài đăng: ' + e.message);
                return false;
            }
        }
    }

    feedManager = new FirebaseFeedManager();

    function switchTab(tabName) {
        currentTab = tabName;
        
        chatTab.classList.toggle('active', tabName === 'chat');
        feedTab.classList.toggle('active', tabName === 'feed');
        
        chatSection.classList.toggle('hidden', tabName !== 'chat');
        feedSection.classList.toggle('hidden', tabName !== 'feed');
        
        if (tabName === 'feed') {
            needsRerender = true;
            feedManager.renderPosts();
            updatePostLimitNotice(); // Don't await in event handler
        }
    }

    async function updatePostLimitNotice() {
        try {
            const todayCount = await feedManager.getTodayPostCount(myId);
            const canPost = await feedManager.canUserPost(myId);
        
        if (postsTodayCount) postsTodayCount.textContent = todayCount;
        
        if (todayCount === 0) {
            postLimitNotice.classList.add('hidden');
        } else {
            postLimitNotice.classList.remove('hidden');
            if (remainingPosts) {
                if (canPost) {
                    remainingPosts.textContent = `Còn lại ${5 - todayCount} bài.`;
                    remainingPosts.style.color = 'var(--text-system-msg)';
                } else {
                    remainingPosts.textContent = 'Đã hết lượt đăng hôm nay.';
                    remainingPosts.style.color = 'var(--downvote-color)';
                }
            }
        }
        
        newPostBtn.disabled = !canPost;
        newPostBtn.style.opacity = canPost ? '1' : '0.5';
        } catch (error) {
            console.error('Error updating post limit notice:', error);
        }
    }

    chatTab.addEventListener('click', () => switchTab('chat'));
    feedTab.addEventListener('click', () => switchTab('feed'));

    async function openNewPostModal() {
        try {
            const canPost = await feedManager.canUserPost(myId);
            if (!canPost) {
            alert('⚠️ Bạn đã đăng đủ 5 bài hôm nay!');
            return;
        }
        newPostModal.classList.remove('hidden');
        postTitle.focus();
        } catch (error) {
            console.error('Error checking post permission:', error);
            // Allow posting if error (fallback)
        newPostModal.classList.remove('hidden');
        postTitle.focus();
        }
    }

    function closeNewPostModal() {
        newPostModal.classList.add('hidden');
        newPostForm.reset();
        updateCharacterCounts();
    }

    // 🎨 AVATAR PICKER SYSTEM
    function openAvatarPicker() {
        populateAvatarGrid();
        avatarPickerModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeAvatarPicker() {
        avatarPickerModal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    function populateAvatarGrid() {
        avatarGrid.innerHTML = '';
        const currentAvatar = localStorage.getItem(`customAvatar_${myId}`);
        
        for (let i = 1; i <= AVATAR_COUNT; i++) {
            const avatarItem = document.createElement('div');
            const isSelected = currentAvatar === String(i) || (!currentAvatar && i === ((parseInt(myId) % AVATAR_COUNT) + 1));
            
            avatarItem.className = `avatar-item cursor-pointer border-2 rounded-lg p-2 transition-all hover:scale-105 ${isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent hover:border-gray-300'}`;
            avatarItem.innerHTML = `
                <img src="${AVATAR_BASE_URL}${i}.png" alt="Avatar ${i}" class="w-16 h-16 rounded-lg object-contain">
                ${isSelected ? '<div class="text-center mt-1 text-xs text-blue-600 font-semibold">✓ Đang dùng</div>' : ''}
            `;
            
            avatarItem.addEventListener('click', () => selectAvatar(i));
            avatarGrid.appendChild(avatarItem);
        }
    }

    function selectAvatar(avatarIndex) {
        // Save custom avatar selection
        localStorage.setItem(`customAvatar_${myId}`, String(avatarIndex));
        
        // Update UI immediately
        const newAvatarUrl = `${AVATAR_BASE_URL}${avatarIndex}.png`;
        myAvatar.src = newAvatarUrl;
        
        // Update avatar grid to show new selection
        populateAvatarGrid();
        
        // Show feedback
        addMessage('system', `🎨 Avatar đã được cập nhật!`);
        
        // Close modal after a short delay
        setTimeout(() => {
            closeAvatarPicker();
        }, 800);
    }

    // Global function for HTML onclick
    window.openAvatarPicker = openAvatarPicker;

    // Avatar picker event listeners
    closeAvatarModal.addEventListener('click', closeAvatarPicker);
    closeAvatarPickerBtn.addEventListener('click', closeAvatarPicker);
    avatarPickerModal.addEventListener('click', (e) => {
        if (e.target === avatarPickerModal) {
            closeAvatarPicker();
        }
    });

    function updateCharacterCounts() {
        if (titleCount && postTitle) titleCount.textContent = postTitle.value.length;
        if (contentCount && postContent) contentCount.textContent = postContent.value.length;
    }

    // Refresh feed function
    async function refreshFeed() {
        console.log('🔄 Refreshing feed...');
        
        if (!refreshFeedBtn) {
            console.error('❌ Refresh button not found');
            return;
        }
        
        // Add spinning animation
        refreshFeedBtn.classList.add('refreshing');
        
        try {
            // Show loading state
            if (feedLoading) {
                feedLoading.classList.remove('hidden');
            }
            if (feedEmpty) {
                feedEmpty.classList.add('hidden');
            }
            
            // Clear current posts
            posts = [];
            if (postsContainer) {
                postsContainer.innerHTML = '';
            }
            
            // Reload posts from Firebase
            if (feedManager && isFirebaseReady) {
                console.log('🔄 Reloading posts from Firebase...');
                
                // Force reload from Firebase
                const postsRef = window.database.ref('posts');
                const snapshot = await postsRef.once('value');
                const firebasePosts = snapshot.val();
                
                if (firebasePosts) {
                    posts = Object.entries(firebasePosts).map(([id, post]) => ({
                        id,
                        ...post
                    }));
                    console.log(`🔄 Loaded ${posts.length} posts from Firebase`);
                } else {
                    console.log('🔄 No posts found in Firebase');
                    posts = [];
                }
                
                // Reload user votes
                await feedManager.loadUserVotes();
                
            } else {
                console.log('🔄 Firebase not available, reloading local posts...');
                // Reload from local storage
                const localPosts = JSON.parse(localStorage.getItem('posts') || '[]');
                posts = localPosts;
            }
            
            // Re-render posts
            if (feedManager) {
                feedManager.renderPosts();
            }
            
            // Update post limit notice
            await updatePostLimitNotice();
            
            console.log('✅ Feed refresh completed');
            
        } catch (error) {
            console.error('❌ Feed refresh failed:', error);
            addMessage('system', '❌ Lỗi khi làm mới bảng tin');
        } finally {
            // Remove spinning animation
            refreshFeedBtn.classList.remove('refreshing');
            
            // Hide loading state
            if (feedLoading) {
                feedLoading.classList.add('hidden');
            }
        }
    }

    newPostBtn.addEventListener('click', openNewPostModal);
    closePostModal.addEventListener('click', closeNewPostModal);
    cancelPostBtn.addEventListener('click', closeNewPostModal);
    
    // Add refresh button event listener
    if (refreshFeedBtn) {
        refreshFeedBtn.addEventListener('click', refreshFeed);
    }

    if (postTitle) postTitle.addEventListener('input', updateCharacterCounts);
    if (postContent) postContent.addEventListener('input', updateCharacterCounts);

    newPostForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const title = postTitle.value.trim();
        const content = postContent.value.trim();
        
        if (!title) {
            alert('⚠️ Vui lòng nhập tiêu đề!');
            return;
        }
        
        try {
            await feedManager.createPost(title, content, myId);
            closeNewPostModal();
            needsRerender = true;
            if (feedManager.renderPosts) {
            feedManager.renderPosts();
            }
            await updatePostLimitNotice();
        } catch (error) {
            alert('⚠️ ' + error.message);
        }
    });

    function updateOnlineCount() {
        // Only update if Firebase is not ready (fallback mode)
        if (isFirebaseReady) return;
        
        const fluctuation = Math.floor(Math.random() * 5) - 2;
        onlineUsers += fluctuation;
        if (onlineUsers < 10) onlineUsers = 10;
        if (onlineUsers > 500) onlineUsers = 500;
        onlineCountEl.textContent = onlineUsers;
    }
    
    function copyToClipboard(text, element) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showCopyFeedback(element);
            });
        }
    }

    function showCopyFeedback(container, success = true) {
        const feedback = document.createElement('span');
        feedback.textContent = success ? ' ✓' : ' ✗';
        feedback.classList.add('copy-feedback', 'text-xs', 'font-bold', 'ml-1');
        feedback.style.color = success ? 'var(--primary-color)' : '#ef4444';
        container.appendChild(feedback);
        
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.remove();
            }
        }, 1500);
    }

    myIdEl.addEventListener('click', () => copyToClipboard(myId, myIdContainer));
    if (strangerIdEl) {
        strangerIdEl.addEventListener('click', () => copyToClipboard(strangerId, strangerIdContainer));
    }
    
    // Disconnect chat button event listener
    if (disconnectChatBtn) {
        disconnectChatBtn.addEventListener('click', async () => {
            if (firebaseChat) {
                await firebaseChat.disconnectChat();
            } else {
                // Fallback for demo mode
                chatWindow.innerHTML = '';
                addMessage('system', '🔄 Demo mode: Tìm người mới...');
                
                do {
                    strangerId = String(Math.floor(Math.random() * 90000000) + 10000000);
                } while (strangerId === myId);
                
                strangerIdEl.textContent = strangerId;
                strangerAvatar.src = getAvatarUrl(strangerId);
                updateConnectionStatus('connected', 'Đã kết nối');
                
                setTimeout(() => {
                    addMessage('system', '🎉 Đã tìm thấy người mới! Chào họ đi nào!');
                }, 1000);
            }
        });
    }

    function applyFont(fontFamily) {
        bodyEl.style.fontFamily = fontFamily;
        localStorage.setItem(`chatFont_${myId}`, fontFamily);
    }

    function applyTheme(theme) {
        bodyEl.classList.remove('theme-simple', 'theme-cute', 'theme-comic');
        bodyEl.classList.add(`theme-${theme}`);
        localStorage.setItem(`chatTheme_${myId}`, theme);
        updateThemeSelectorUI(theme);
        currentTheme = theme;
        
        // Set default font for Comic theme
        if (theme === 'comic') {
            const currentFont = localStorage.getItem(`chatFont_${myId}`);
            if (!currentFont || currentFont === "'Nunito', sans-serif") {
                applyFont("'Mali', cursive");
                if (fontSwitcher) fontSwitcher.value = "'Mali', cursive";
                if (fontSwitcherDesktop) fontSwitcherDesktop.value = "'Mali', cursive";
            }
        }
    }
    
    function updateThemeSelectorUI(theme) {
        if (themeSelectorMobile) {
            themeSelectorMobile.value = theme;
        }
        
        if (themeSelectorDesktop) {
            themeSelectorDesktop.value = theme;
        }
    }

    function setDarkMode(isDark) {
        htmlEl.classList.toggle('dark', isDark);
        localStorage.setItem(`darkMode_${myId}`, isDark ? 'enabled' : 'disabled');
        isDarkMode = isDark;
    }

    function setupThemeListeners() {
        if (fontSwitcher) {
            fontSwitcher.addEventListener('change', (e) => {
                applyFont(e.target.value);
                if (fontSwitcherDesktop) {
                    fontSwitcherDesktop.value = e.target.value;
                }
            });
        }
        
        if (fontSwitcherDesktop) {
            fontSwitcherDesktop.addEventListener('change', (e) => {
                applyFont(e.target.value);
                if (fontSwitcher) {
                    fontSwitcher.value = e.target.value;
                }
            });
        }
        
        if (themeSelectorMobile) {
            themeSelectorMobile.addEventListener('change', (e) => {
                applyTheme(e.target.value);
                if (themeSelectorDesktop) {
                    themeSelectorDesktop.value = e.target.value;
                }
            });
        }
        
        if (themeSelectorDesktop) {
            themeSelectorDesktop.addEventListener('change', (e) => {
                applyTheme(e.target.value);
                if (themeSelectorMobile) {
                    themeSelectorMobile.value = e.target.value;
                }
            });
        }
        
        if (darkModeBtn) {
            darkModeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                setDarkMode(!isDarkMode);
            });
        }
        
        if (darkModeBtnDesktop) {
            darkModeBtnDesktop.addEventListener('click', (e) => {
                e.preventDefault();
                setDarkMode(!isDarkMode);
            });
        }
    }

    setupThemeListeners();

    const savedFont = localStorage.getItem(`chatFont_${myId}`) || "'Nunito', sans-serif";
    const savedTheme = localStorage.getItem(`chatTheme_${myId}`) || 'cute';
    const savedMode = localStorage.getItem(`darkMode_${myId}`) === 'enabled';
    
    if (fontSwitcher) fontSwitcher.value = savedFont;
    if (fontSwitcherDesktop) fontSwitcherDesktop.value = savedFont;
    if (themeSelectorMobile) themeSelectorMobile.value = savedTheme;
    if (themeSelectorDesktop) themeSelectorDesktop.value = savedTheme;
    applyFont(savedFont);
    applyTheme(savedTheme);
    setDarkMode(savedMode);

    // --- CHAT REPLY LOGIC ---
    function startReply(messageData) {
        replyingTo = messageData;
        replyPreviewText.textContent = replyingTo.text;
        replyAuthor.textContent = `Đang trả lời ${replyingTo.sender === 'me' ? 'bạn' : 'người lạ'}:`;
        replyAvatar.src = replyingTo.sender === 'me' ? getAvatarUrl(myId) : getAvatarUrl(strangerId);
        replyPreviewContainer.classList.remove('hidden');
        messageInput.focus();
    }

    function cancelReply() {
        replyingTo = null;
        replyPreviewContainer.classList.add('hidden');
    }

    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            cancelReply();
        });
    }

    function addMessage(sender, text, options = {}) {
        const { replyTo = null } = options;
        const msgId = Date.now() + Math.random();

        // ✨ ENHANCED: Clear old system messages when new system message appears, but keep important notifications
        if (sender === 'system') {
            const existingSystemMessages = chatWindow.querySelectorAll('.msg-content[style*="--bg-system-msg"]');
            existingSystemMessages.forEach(msg => {
                const wrapper = msg.closest('.flex');
                const text = msg.textContent || '';
                // Don't clear important notifications like "Người lạ đã rời đi"
                if (wrapper && !text.includes('Người lạ đã rời đi') && !text.includes('Đã rời chat')) {
                    wrapper.remove();
                }
            });
        }

        const msgWrapper = document.createElement('div');
        msgWrapper.classList.add('flex', 'items-end', 'space-x-2', 'msg-pop-in');
        msgWrapper.dataset.id = msgId;
        
        const msgContent = document.createElement('div');
        msgContent.classList.add('msg-content', 'break-words');
        msgContent.style.borderRadius = 'var(--rounded-msg)';

        if (replyTo) {
            const replyBlock = document.createElement('div');
            replyBlock.classList.add('mb-2', 'p-2', 'text-xs', 'border-l-2', 'opacity-80', 'bg-black', 'bg-opacity-10', 'rounded');
            replyBlock.style.borderColor = 'var(--border-reply)';
            
            replyBlock.innerHTML = `
                <div class="font-semibold text-xs opacity-75 flex items-center">
                    <img src="${replyTo.sender === 'me' ? getAvatarUrl(myId) : getAvatarUrl(strangerId)}" class="avatar w-3 h-3 mr-1">
                    ${replyTo.sender === 'me' ? 'Bạn' : 'Người lạ'}:
                </div>
                <div class="truncate">${replyTo.text}</div>
            `;
            msgContent.appendChild(replyBlock);
        }

        const textElement = document.createElement('div');
        textElement.textContent = text;
        msgContent.appendChild(textElement);
        
        if (sender !== 'system') {
            msgContent.classList.add('cursor-pointer');
            msgContent.addEventListener('click', () => {
                startReply({ id: msgId, text: text, sender: sender });
            });
        }

        if (sender === 'me') {
            msgWrapper.classList.add('justify-end');
            msgContent.style.backgroundColor = 'var(--bg-my-msg)';
            msgContent.style.color = 'var(--text-my-msg)';
        } else if (sender === 'stranger') {
            msgWrapper.classList.add('justify-start');
            msgContent.style.backgroundColor = 'var(--bg-stranger-msg)';
            msgContent.style.color = 'var(--text-stranger-msg)';
        } else {
            msgWrapper.classList.add('justify-center');
            msgContent.classList.add('text-center', 'w-full', 'max-w-full', 'cursor-default', 'italic');
            msgContent.style.backgroundColor = 'var(--bg-system-msg)';
            msgContent.style.color = 'var(--text-system-msg)';
        }
        
        msgWrapper.appendChild(msgContent);
        chatWindow.appendChild(msgWrapper);
        
        setTimeout(() => {
            chatWindow.scrollTop = chatWindow.scrollHeight;
        }, 100);
    }

    function showTypingIndicator() {
        typingIndicator.classList.remove('hidden');
    }

    function hideTypingIndicator() {
        typingIndicator.classList.add('hidden');
    }

    // This old event listener is removed - will be replaced below

    // Removed simulateStrangerResponse - only real chat now

    newPostModal.addEventListener('click', (e) => {
        if (e.target === newPostModal) {
            closeNewPostModal();
        }
    });

    // OPTIMIZED: Background cleanup to remove abandoned chats
    function setupBackgroundCleanup() {
        if (!isFirebaseReady) return;
        
        // Run cleanup every 5 minutes
        setInterval(async () => {
            try {
                console.log('🧹 Running background chat cleanup...');
                
                const chatsRef = window.database.ref('chats');
                const now = Date.now();
                const fiveMinutesAgo = now - (5 * 60 * 1000); // 5 minutes
                
                // Get all chats
                const snapshot = await chatsRef.once('value');
                if (!snapshot.exists()) return;
                
                const chats = snapshot.val();
                let deletedCount = 0;
                
                for (const [chatId, chatData] of Object.entries(chats)) {
                    // Delete if:
                    // 1. No participants (completely empty)
                    // 2. Only 1 participant and very old (> 15 minutes)
                    // 3. Very old regardless of participants (> 30 minutes)
                    
                    const participants = chatData.participants || {};
                    const participantCount = Object.keys(participants).length;
                    const lastActivity = chatData.lastActivity || chatData.createdAt || 0;
                    const fifteenMinutesAgo = now - (15 * 60 * 1000);
                    const thirtyMinutesAgo = now - (30 * 60 * 1000);
                    
                    if (participantCount === 0 || 
                        (participantCount === 1 && lastActivity < fifteenMinutesAgo) ||
                        lastActivity < thirtyMinutesAgo) {
                        
                        console.log(`🗑️ Deleting abandoned chat: ${chatId} (${participantCount} participants, last active: ${new Date(lastActivity).toLocaleString()})`);
                        
                        await chatsRef.child(chatId).remove();
                        deletedCount++;
                    }
                }
                
                if (deletedCount > 0) {
                    console.log(`🧹 Cleaned up ${deletedCount} abandoned chats`);
                }
                
            } catch (error) {
                console.error('❌ Background cleanup error:', error);
            }
        }, 300000); // Every 5 minutes
        
        console.log('🧹 Background cleanup job started (every 5 minutes)');
    }

    // Initialize Firebase and start app
    async function initializeApp() {
        console.log('🚀 Initializing Chạm Ngõ...');
        
        // Set user info first
        myIdEl.textContent = myId;
        myAvatar.src = getAvatarUrl(myId); // This now checks for custom avatar
        
        // Set random stranger avatar when app starts
        const randomAvatarIndex = Math.floor(Math.random() * 12) + 1;
        strangerAvatar.src = `${AVATAR_BASE_URL}${randomAvatarIndex}.png`;
        
        // Set initial connection status
        updateConnectionStatus('idle', 'Sẵn sàng để bắt đầu chat!');
        
        // Initialize Firebase
        const firebaseConnected = await initializeFirebase();
        
        if (firebaseConnected) {
            console.log('✅ Firebase mode: Realtime chat and posts enabled');
            
            // Start background cleanup for abandoned chats
            setupBackgroundCleanup();
            
            try {
                // Setup online presence immediately
                setupOnlinePresence();
                
                // Initialize Firebase chat immediately
                firebaseChat = new FirebaseChat();
                
                // Run diagnostic test first, but don't start matching automatically
                setTimeout(async () => {
                    try {
                        console.log('🔍 Running pre-chat diagnostics...');
                        
                        // Run Firebase diagnostic first
                        const diagnosticResult = await testFirebaseAccess();
                        
                        if (!diagnosticResult) {
                            addMessage('system', '❌ Firebase diagnostic failed. Kiểm tra Database Rules!');
                            addMessage('system', '🔄 Thử refresh trang. Nếu vẫn lỗi, kiểm tra Firebase Console.');
                            return;
                        }
                        
                        console.log('✅ Firebase diagnostic passed. Ready for user to start chat.');
                        
                    } catch (error) {
                        console.error('❌ Firebase diagnostic failed with error:', error);
                        console.error('❌ Error details:', {
                            name: error.name,
                            message: error.message,
                            stack: error.stack
                        });
                        
                        addMessage('system', '❌ Lỗi kết nối Firebase');
                    }
                }, 500);
                
            } catch (error) {
                console.error('❌ Firebase chat initialization failed:', error);
                addMessage('system', '❌ Lỗi khởi tạo chat');
            }
            
        } else {
            console.log('⚠️ Offline mode: Firebase not ready');
            updateConnectionStatus('offline', 'Offline');
            addMessage('system', '📱 Chế độ Offline');
            
            // Clear stranger info in offline mode
            strangerIdEl.textContent = '';
            strangerAvatar.src = '';
            
            // Simulated online count updates only in offline mode
            updateOnlineCount();
            setInterval(updateOnlineCount, 5000);
        }
        
        // Initialize feed manager (works in both modes)
        console.log('📝 Initializing feed manager...');
        await initializeFeedManager();
        
        // Show user ID (removed system message)
        
        // Focus message input
        messageInput.focus();
        
        // Render posts after short delay
        setTimeout(() => {
            needsRerender = true;
            if (feedManager && feedManager.renderPosts) {
                feedManager.renderPosts();
                console.log('📝 Posts rendered successfully');
            } else {
                console.warn('⚠️ FeedManager not ready yet');
            }
        }, 800);
        
        console.log('🎉 Chạm Ngõ initialized with stable ID:', myId);
        console.log('🖼️ Avatar URL:', getAvatarUrl(myId));
    }

    // Global debug functions for console (moved to end of file to avoid duplicates)
    
    window.forceMatchmaking = async () => {
        console.log('🔧 Force triggering matchmaking...');
        
        if (!firebaseChat) {
            console.log('❌ FirebaseChat not initialized');
            return;
        }
        
        try {
            // Check if we're in a waiting chat with only ourselves
            if (firebaseChat.currentChatId && firebaseChat.chatRef) {
                const chatSnapshot = await firebaseChat.chatRef.once('value');
                const chatData = chatSnapshot.val();
                
                if (chatData && chatData.participantCount === 1 && chatData.status === 'waiting') {
                    console.log('🗑️ Leaving current waiting chat to force new match...');
                    
                    // Delete the current waiting chat since we're alone
                    await firebaseChat.chatRef.remove();
                    firebaseChat.cleanupLocalState();
                    
                    // Wait a moment then try to find new chat
                    setTimeout(async () => {
                        await firebaseChat.findChat();
                    }, 1000);
                    
                    return;
                }
            }
            
            // If not in chat or in queue, try matchmaking
            if (firebaseChat.waitingQueue && !firebaseChat.currentChatId) {
                const queueSnapshot = await window.database.ref('waitingQueue').once('value');
                const queueData = queueSnapshot.val();
                
                if (queueData) {
                    const otherUsers = Object.keys(queueData).filter(id => id !== myId);
                    console.log('🎯 Found other users for forced matching:', otherUsers);
                    
                    for (const userId of otherUsers) {
                        const userData = queueData[userId];
                        if (userData && userData.status === 'waiting') {
                            console.log(`🚀 Force attempting match with: ${userId}`);
                            try {
                                const chatId = await firebaseChat.findOrCreateChatWithUser(userId);
                                if (chatId) {
                                    console.log(`✅ Force match successful with: ${userId}`);
                                    return;
                                }
                            } catch (error) {
                                console.error(`❌ Force match failed with ${userId}:`, error);
                            }
                        }
                    }
                } else {
                    console.log('📊 No other users in queue to force match with');
                }
            } else {
                console.log('❌ Cannot force matchmaking - conditions not met');
                console.log('Debug:', {
                    hasWaitingQueue: !!firebaseChat.waitingQueue,
                    currentChatId: firebaseChat.currentChatId,
                    participantCount: firebaseChat.chatRef ? 'checking...' : 'no chat ref'
                });
            }
        } catch (error) {
            console.error('❌ Force matchmaking failed:', error);
        }
    };
    
    window.debugQueue = async () => {
        console.log('🔍 Debug: Queue and Chat Status');
        
        try {
            // Check waiting queue
            const queueSnapshot = await window.database.ref('waitingQueue').once('value');
            const queueData = queueSnapshot.val();
            console.log('📊 Waiting Queue:', queueData);
            
            // Check online presence
            const presenceSnapshot = await window.database.ref('presence').once('value');
            const presenceData = presenceSnapshot.val();
            console.log('👥 Online Presence:', presenceData);
            
            // Check waiting chats
            const chatsSnapshot = await window.database.ref('chats').orderByChild('status').equalTo('waiting').once('value');
            const waitingChats = chatsSnapshot.val();
            console.log('⏳ Waiting Chats:', waitingChats);
            
            // Check active chats
            const activeChatsSnapshot = await window.database.ref('chats').orderByChild('status').equalTo('active').once('value');
            const activeChats = activeChatsSnapshot.val();
            console.log('🔥 Active Chats:', activeChats);
            
            // My current state
            if (firebaseChat) {
                console.log('🤖 My State:', {
                    myId: myId,
                    currentChatId: firebaseChat.currentChatId,
                    hasWaitingQueue: !!firebaseChat.waitingQueue,
                    currentPartner: firebaseChat.currentPartner
                });
            }
            
        } catch (error) {
            console.error('❌ Debug queue failed:', error);
        }
    };
    
    window.forceRefreshMatching = async () => {
        console.log('🔄 Force refreshing matching system...');
        
        if (!firebaseChat) {
            console.log('❌ FirebaseChat not initialized');
            return;
        }
        
        try {
            // Clean up current state completely
            if (firebaseChat.currentChatId && firebaseChat.chatRef) {
                console.log('🧹 Cleaning up current chat...');
                await firebaseChat.chatRef.remove();
            }
            
            if (firebaseChat.waitingQueue) {
                console.log('🧹 Removing from waiting queue...');
                await firebaseChat.waitingQueue.remove();
            }
            
            // Clean up local state
            firebaseChat.cleanupLocalState();
            
            // Clear chat UI
            chatWindow.innerHTML = '';
            
            // Update status
            updateConnectionStatus('connecting', 'Khởi động lại...');
            addMessage('system', '🔄 Đang khởi động lại hệ thống matching...');
            
            // Wait 2 seconds then restart
            setTimeout(async () => {
                console.log('🚀 Restarting chat search...');
                await firebaseChat.findChat();
            }, 2000);
            
        } catch (error) {
            console.error('❌ Force refresh failed:', error);
        }
    };
    
    // Update message form to use Firebase chat
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (!text) return;
        
        // Prevent rapid double-send
        if (sendBtn.disabled) return;
        sendBtn.disabled = true;
        setTimeout(() => sendBtn.disabled = false, 1000);

        const contentCheck = containsBlockedContent(text);
        if (contentCheck.blocked) {
            addMessage('system', '🚫 Không được gửi link trong chat');
            messageInput.value = '';
            return;
        }

        if (text.toLowerCase() === 'help') {
            addMessage('system', '💡 Hướng dẫn:\n• Nhấp tin nhắn để trả lời\n• ID cố định: ' + myId + '\n• Tab "Bảng Tin" để đăng bài\n• Vote và bình luận như Reddit\n• ' + (isFirebaseReady ? 'Realtime với Firebase!' : 'Demo mode với localStorage') + '\n\n🔧 Debug Commands (mở Console):\n• testConnectionButton() - Test nút disconnect\n• debugChat() - Debug chat state\n• debugConnection() - Debug connection sync\n• debugFirebase() - Debug Firebase status\n• debugQueue() - Xem trạng thái queue\n• forceMatchmaking() - Force matching\n• forceRefreshMatching() - Restart toàn bộ\n• testChatSystem() - Test chat system');
            messageInput.value = '';
            return;
        }

        // ❌ REMOVED: Do NOT display message locally - let Firebase handle ALL display
        // addMessage('me', text, { replyTo: replyingTo });
        
        // Check connection status before sending
        if (isFirebaseReady && firebaseChat && firebaseChat.currentChatId && strangerId) {
            // Connected to chat partner - send message
            firebaseChat.sendMessage(text, replyingTo?.text || null);
        } else if (isFirebaseReady && firebaseChat) {
            // Firebase ready but no chat partner
            addMessage('system', '⚠️ Chưa kết nối với ai. Hãy đợi kết nối!');
        } else {
            // Firebase not ready - offline mode
            addMessage('me', text, { replyTo: replyingTo }); // Only for offline mode
            addMessage('system', '📱 Chat cần Firebase. Posts/votes hoạt động offline.');
        }
        
        messageInput.value = '';
        cancelReply();
    });

    // Typing indicator for Firebase
    messageInput.addEventListener('input', () => {
        if (isFirebaseReady && firebaseChat) {
            firebaseChat.sendTyping();
        }
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            
            // Prevent duplicate sending (same protection as submit button)
            if (sendBtn.disabled) return;
            
            // Manually trigger the same logic as form submit without dispatching event
            const text = messageInput.value.trim();
            if (!text) return;
            
            // Use the send button click to trigger submission (unified path)
            sendBtn.click();
        }
    });

    // Connection action button event listener
    console.log('🔧 Setting up connection action button event listener:', {
        connectionActionBtn: !!connectionActionBtn,
        buttonElement: connectionActionBtn
    });
    
    if (connectionActionBtn) {
        connectionActionBtn.addEventListener('click', handleConnectionAction);
        console.log('✅ Connection action button event listener attached successfully');
    } else {
        console.error('❌ Connection action button not found! Cannot attach event listener');
    }

    // Start the app
    initializeApp();
    
    // Validate debug functions are available
    setTimeout(() => {
        const debugFunctions = [
            'testConnectionButton',
            'debugChat', 
            'debugConnection',
            'debugFirebase',
            'debugQueue',
            'forceMatchmaking',
            'forceRefreshMatching',
            'testChatSystem'
        ];
        
        const availableFunctions = debugFunctions.filter(fn => typeof window[fn] === 'function');
        const missingFunctions = debugFunctions.filter(fn => typeof window[fn] !== 'function');
        
        console.log('🔧 Debug Functions Validation:');
        console.log('✅ Available:', availableFunctions);
        if (missingFunctions.length > 0) {
            console.log('❌ Missing:', missingFunctions);
        } else {
            console.log('✅ All debug functions loaded successfully!');
            console.log('📝 Type "help" in chat for debug commands list');
        }
    }, 1000);
    
    // Expose debug functions to console
    window.debugChat = () => {
        if (firebaseChat) {
            firebaseChat.debugChatState();
        } else {
            console.log('🐛 No Firebase chat instance');
        }
    };
    
    window.debugConnection = () => {
        if (firebaseChat) {
            firebaseChat.debugConnectionSync();
        } else {
            console.log('❌ FirebaseChat not initialized yet');
        }
    };
    
    window.debugDuplicates = () => {
        if (firebaseChat) {
            firebaseChat.debugDuplicateMessages();
        } else {
            console.log('❌ FirebaseChat not initialized yet');
        }
    };
    
    window.fixDuplicateMessages = () => {
        console.log('🔧 Attempting to fix duplicate messages...');
        if (firebaseChat) {
            firebaseChat.debugDuplicateMessages();
        } else {
            console.log('❌ FirebaseChat not initialized yet');
        }
    };
    
    window.debugFirebase = () => {
        console.log('🐛 Firebase Debug:', {
            isFirebaseReady: isFirebaseReady,
            hasFirebaseConfig: !!window.firebase,
            hasDatabase: !!window.database,
            myId: myId
        });
    };
    
    window.testFirebaseAccess = testFirebaseAccess;
    
    // 🔧 ENHANCED: Test connection button with better debugging
    window.testConnectionButton = () => {
        console.log('🧪 Testing connection button functionality...');
        
        console.log('🔧 Button Elements:', {
            connectionActionBtn: !!connectionActionBtn,
            actionBtnText: !!actionBtnText,
            currentText: actionBtnText?.textContent,
            disabled: connectionActionBtn?.disabled,
            style: connectionActionBtn?.style?.backgroundColor,
            firebaseChat: !!firebaseChat,
            disconnectMethod: firebaseChat ? typeof firebaseChat.disconnectChat : 'no firebaseChat',
            chatState: firebaseChat ? {
                currentChatId: firebaseChat.currentChatId,
                hasChatRef: !!firebaseChat.chatRef,
                hasWaitingQueue: !!firebaseChat.waitingQueue
            } : 'no firebaseChat'
        });
        
        if (connectionActionBtn && actionBtnText) {
            console.log('✅ Button found, triggering handleConnectionAction...');
            handleConnectionAction();
            
            // Additional test - direct disconnect call if in connected state
            if (actionBtnText.textContent === 'Rời đoạn chat' && firebaseChat) {
                console.log('🔧 Also testing direct disconnectChat call...');
        setTimeout(() => {
                    console.log('🚀 Calling disconnectChat directly...');
                    firebaseChat.disconnectChat();
        }, 2000);
    }
        } else {
            console.error('❌ Connection button elements not found');
        }
    };
    
    // Quick test function for chat functionality
    window.testChatSystem = async () => {
        console.log('🧪 Testing chat system...');
        
        try {
            if (!firebaseChat) {
                console.log('❌ No FirebaseChat instance');
                return false;
            }
            
            console.log('🔍 Current chat state:', {
                isFirebaseReady: isFirebaseReady,
                currentChatId: firebaseChat.currentChatId,
                hasChatRef: !!firebaseChat.chatRef,
                hasWaitingQueue: !!firebaseChat.waitingQueue
            });
            
            // Test creating a message reference
            if (firebaseChat.chatRef) {
                const testMsgRef = firebaseChat.chatRef.child('messages').push();
                console.log('✅ Message reference created:', testMsgRef.key);
                
                // Don't actually send - just test the reference
                console.log('✅ Chat system looks good!');
                return true;
            } else {
                console.log('⏳ No active chat room yet');
                return false;
            }
            
        } catch (error) {
            console.error('❌ Chat system test failed:', error);
            return false;
        }
    };

    if (postContent) {
        postContent.addEventListener('paste', function(e) {
            e.preventDefault();
            let text = (e.clipboardData || window.clipboardData).getData('text');
            // Làm sạch: loại bỏ dòng trống đầu/cuối, khoảng trắng đầu dòng, ký tự ẩn
            text = text
                .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // loại bỏ zero-width
                .split('\n')
                .map(line => line.replace(/^\s+/, ''))
                .filter((line, idx, arr) => {
                    if (line.trim() !== '') return true;
                    if (idx === 0 || idx === arr.length - 1) return false;
                    return true;
                })
                .join('\n');
            // Dán lại nội dung đã làm sạch
            const start = postContent.selectionStart;
            const end = postContent.selectionEnd;
            const value = postContent.value;
            postContent.value = value.slice(0, start) + text + value.slice(end);
            // Đặt lại vị trí con trỏ
            postContent.selectionStart = postContent.selectionEnd = start + text.length;
            // Cập nhật đếm ký tự
            if (typeof updateCharacterCounts === 'function') updateCharacterCounts();
        });
    }

    // ... existing code ...
    window.addEventListener('beforeunload', function (e) {
        // Nếu đang trong đoạn chat hoặc đang tìm người, cảnh báo
        if (firebaseChat && (firebaseChat.currentChatId || actionBtnText.textContent === 'Đang kết nối' || actionBtnText.textContent === 'Rời đoạn chat')) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    });
    // ... existing code ...
});