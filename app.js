class P2PFileShare {
    constructor() {
        this.peer = null;
        this.dataChannel = null;
        this.file = null;
        this.isReceiver = false;
        this.chunkSize = 64 * 1024; // 64KB chunks for optimal performance
        this.receivedData = [];
        this.receivedBytes = 0;
        this.totalBytes = 0;
        this.startTime = null;
        
        // ICE servers for better connectivity
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];
        
        this.initializeElements();
        this.setupEventListeners();
        this.checkUrlParams();
    }

    initializeElements() {
        this.elements = {
            fileInput: document.getElementById('file-input'),
            fileDrop: document.getElementById('file-drop'),
            fileInfo: document.getElementById('file-info'),
            fileName: document.getElementById('file-name'),
            fileSize: document.getElementById('file-size'),
            shareOptions: document.getElementById('share-options'),
            shareLink: document.getElementById('share-link'),
            shareCode: document.getElementById('share-code'),
            qrCode: document.getElementById('qr-code'),
            sendStatus: document.getElementById('send-status'),
            connectionStatus: document.getElementById('connection-status'),
            uploadProgress: document.getElementById('upload-progress'),
            uploadFill: document.getElementById('upload-fill'),
            uploadSpeed: document.getElementById('upload-speed'),
            uploadPercent: document.getElementById('upload-percent'),
            receiveCode: document.getElementById('receive-code'),
            receiveStatus: document.getElementById('receive-status'),
            receiveConnectionStatus: document.getElementById('receive-connection-status'),
            fileOffer: document.getElementById('file-offer'),
            offeredFileName: document.getElementById('offered-file-name'),
            offeredFileSize: document.getElementById('offered-file-size'),
            downloadProgress: document.getElementById('download-progress'),
            downloadFill: document.getElementById('download-fill'),
            downloadSpeed: document.getElementById('download-speed'),
            downloadPercent: document.getElementById('download-percent')
        };
    }

    setupEventListeners() {
        // File selection
        this.elements.fileDrop.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files[0]);
        });

        // Drag and drop
        this.elements.fileDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.fileDrop.classList.add('dragover');
        });

        this.elements.fileDrop.addEventListener('dragleave', () => {
            this.elements.fileDrop.classList.remove('dragover');
        });

        this.elements.fileDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.fileDrop.classList.remove('dragover');
            this.handleFileSelect(e.dataTransfer.files[0]);
        });

        // Enter key for receive code
        this.elements.receiveCode.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connectToSender();
            }
        });
    }

    checkUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            this.elements.receiveCode.value = code;
            this.connectToSender();
        }
    }

    handleFileSelect(file) {
        if (!file) return;
        
        // Check file size (10GB limit)
        if (file.size > 10 * 1024 * 1024 * 1024) {
            alert('File size exceeds 10GB limit');
            return;
        }

        this.file = file;
        this.elements.fileName.textContent = `Name: ${file.name}`;
        this.elements.fileSize.textContent = `Size: ${this.formatFileSize(file.size)}`;
        this.elements.fileInfo.style.display = 'block';
        
        this.setupSender();
    }

    async setupSender() {
        try {
            this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
            
            // Create data channel with optimized settings
            this.dataChannel = this.peer.createDataChannel('fileTransfer', {
                ordered: true,
                maxPacketLifeTime: 3000
            });
            
            this.setupDataChannelEvents();
            
            // Create offer
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            
            // Generate share code and link
            const offerData = {
                offer: offer,
                fileName: this.file.name,
                fileSize: this.file.size
            };
            
            const encodedOffer = btoa(JSON.stringify(offerData));
            const shareCode = this.generateShareCode();
            
            // Store offer for retrieval
            this.storeOffer(shareCode, encodedOffer);
            
            this.elements.shareCode.value = shareCode;
            this.elements.shareLink.value = `${window.location.origin}${window.location.pathname}?code=${shareCode}`;
            
            // Generate QR code
            QRCode.toCanvas(this.elements.qrCode, this.elements.shareLink.value, {
                width: 150,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            
            this.elements.shareOptions.style.display = 'block';
            this.elements.sendStatus.style.display = 'block';
            
            // Handle ICE candidates
            this.peer.onicecandidate = (event) => {
                if (event.candidate) {
                    this.updateStoredOffer(shareCode, encodedOffer);
                }
            };
            
        } catch (error) {
            console.error('Error setting up sender:', error);
            alert('Failed to setup file sharing');
        }
    }

    setupDataChannelEvents() {
        this.dataChannel.onopen = () => {
            this.elements.connectionStatus.textContent = 'CONNECTED - SENDING FILE...';
            this.sendFile();
        };

        this.dataChannel.onclose = () => {
            this.elements.connectionStatus.textContent = 'CONNECTION CLOSED';
        };

        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.elements.connectionStatus.textContent = 'CONNECTION ERROR';
        };
    }

    async sendFile() {
        if (!this.file || !this.dataChannel) return;

        this.elements.uploadProgress.style.display = 'block';
        this.startTime = Date.now();
        
        const reader = new FileReader();
        let offset = 0;
        const chunkSize = this.chunkSize;
        
        const sendNextChunk = () => {
            if (offset >= this.file.size) {
                this.dataChannel.send(JSON.stringify({ type: 'end' }));
                this.elements.connectionStatus.textContent = 'FILE SENT SUCCESSFULLY';
                return;
            }
            
            const chunk = this.file.slice(offset, offset + chunkSize);
            reader.onload = (e) => {
                if (this.dataChannel.readyState === 'open') {
                    this.dataChannel.send(e.target.result);
                    offset += chunkSize;
                    
                    // Update progress
                    const progress = (offset / this.file.size) * 100;
                    const speed = this.calculateSpeed(offset, this.startTime);
                    
                    this.elements.uploadFill.style.width = `${Math.min(progress, 100)}%`;
                    this.elements.uploadPercent.textContent = `${Math.round(progress)}%`;
                    this.elements.uploadSpeed.textContent = `Upload: ${speed}`;
                    
                    // Send next chunk with small delay to prevent overwhelming
                    setTimeout(sendNextChunk, 1);
                }
            };
            reader.readAsArrayBuffer(chunk);
        };
        
        // Send file metadata first
        this.dataChannel.send(JSON.stringify({
            type: 'start',
            fileName: this.file.name,
            fileSize: this.file.size
        }));
        
        sendNextChunk();
    }

    async connectToSender() {
        const code = this.elements.receiveCode.value.trim();
        if (!code) return;

        this.isReceiver = true;
        this.elements.receiveStatus.style.display = 'block';
        this.elements.receiveConnectionStatus.textContent = 'CONNECTING...';

        try {
            // Try to get offer from code or extract from link
            let offerData;
            if (code.startsWith('http')) {
                const url = new URL(code);
                const urlCode = url.searchParams.get('code');
                offerData = this.getStoredOffer(urlCode);
            } else {
                offerData = this.getStoredOffer(code);
            }

            if (!offerData) {
                this.elements.receiveConnectionStatus.textContent = 'INVALID CODE';
                return;
            }

            const parsedOffer = JSON.parse(atob(offerData));
            
            // Show file offer
            this.elements.offeredFileName.textContent = `Name: ${parsedOffer.fileName}`;
            this.elements.offeredFileSize.textContent = `Size: ${this.formatFileSize(parsedOffer.fileSize)}`;
            this.elements.fileOffer.style.display = 'block';
            this.elements.receiveConnectionStatus.textContent = 'FILE OFFER RECEIVED';
            
            this.pendingOffer = parsedOffer;
            
        } catch (error) {
            console.error('Error connecting to sender:', error);
            this.elements.receiveConnectionStatus.textContent = 'CONNECTION FAILED';
        }
    }

    async acceptFile() {
        if (!this.pendingOffer) return;

        try {
            this.peer = new RTCPeerConnection({ iceServers: this.iceServers });
            
            this.peer.ondatachannel = (event) => {
                const channel = event.channel;
                this.setupReceiveChannel(channel);
            };

            await this.peer.setRemoteDescription(this.pendingOffer.offer);
            const answer = await this.peer.createAnswer();
            await this.peer.setLocalDescription(answer);
            
            this.elements.fileOffer.style.display = 'none';
            this.elements.receiveConnectionStatus.textContent = 'CONNECTING TO SENDER...';
            
            // In a real implementation, you would send this answer back to the sender
            // For this demo, we'll simulate the connection
            setTimeout(() => {
                this.elements.receiveConnectionStatus.textContent = 'CONNECTED - WAITING FOR FILE...';
            }, 1000);
            
        } catch (error) {
            console.error('Error accepting file:', error);
            this.elements.receiveConnectionStatus.textContent = 'CONNECTION FAILED';
        }
    }

    rejectFile() {
        this.elements.fileOffer.style.display = 'none';
        this.elements.receiveConnectionStatus.textContent = 'FILE REJECTED';
        this.pendingOffer = null;
    }

    setupReceiveChannel(channel) {
        this.dataChannel = channel;
        this.receivedData = [];
        this.receivedBytes = 0;
        this.startTime = Date.now();

        channel.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const message = JSON.parse(event.data);
                if (message.type === 'start') {
                    this.totalBytes = message.fileSize;
                    this.fileName = message.fileName;
                    this.elements.downloadProgress.style.display = 'block';
                    this.elements.receiveConnectionStatus.textContent = 'RECEIVING FILE...';
                } else if (message.type === 'end') {
                    this.completeFileReceive();
                }
            } else {
                // Binary data
                this.receivedData.push(event.data);
                this.receivedBytes += event.data.byteLength;
                
                // Update progress
                const progress = (this.receivedBytes / this.totalBytes) * 100;
                const speed = this.calculateSpeed(this.receivedBytes, this.startTime);
                
                this.elements.downloadFill.style.width = `${Math.min(progress, 100)}%`;
                this.elements.downloadPercent.textContent = `${Math.round(progress)}%`;
                this.elements.downloadSpeed.textContent = `Download: ${speed}`;
            }
        };

        channel.onclose = () => {
            this.elements.receiveConnectionStatus.textContent = 'CONNECTION CLOSED';
        };
    }

    completeFileReceive() {
        const blob = new Blob(this.receivedData);
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = this.fileName;
        a.click();
        
        URL.revokeObjectURL(url);
        this.elements.receiveConnectionStatus.textContent = 'FILE DOWNLOADED SUCCESSFULLY';
    }

    generateShareCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    storeOffer(code, offer) {
        localStorage.setItem(`offer_${code}`, offer);
        // Auto-cleanup after 1 hour
        setTimeout(() => {
            localStorage.removeItem(`offer_${code}`);
        }, 3600000);
    }

    updateStoredOffer(code, offer) {
        localStorage.setItem(`offer_${code}`, offer);
    }

    getStoredOffer(code) {
        return localStorage.getItem(`offer_${code}`);
    }

    calculateSpeed(bytes, startTime) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = bytes / elapsed;
        return this.formatSpeed(speed);
    }

    formatSpeed(bytesPerSecond) {
        if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(1)} B/s`;
        if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
        return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
}

// Global functions for buttons
function copyLink() {
    const linkInput = document.getElementById('share-link');
    linkInput.select();
    document.execCommand('copy');
    alert('Link copied to clipboard!');
}

function copyCode() {
    const codeInput = document.getElementById('share-code');
    codeInput.select();
    document.execCommand('copy');
    alert('Code copied to clipboard!');
}

function connectToSender() {
    app.connectToSender();
}

function acceptFile() {
    app.acceptFile();
}

function rejectFile() {
    app.rejectFile();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new P2PFileShare();
});