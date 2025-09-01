; (function () {
    "use strict"

    class AiAgentPlugin {
        constructor(config) {
            this.config = {
                agentId: config.agentId || "default",
                primaryColor: config.primaryColor || "#000000",
                secondaryColor: config.secondaryColor || "#333333",
                chatBubbleColor: config.chatBubbleColor || "#f5f5f5",
                agentName: config.agentName || "Assistant",
                agentTitle: config.agentTitle || "Virtual Assistant",
                apiUrl: config.apiUrl || null,
                fabColor: config.fabColor || null, // Uses primaryColor if not set
                fabText: config.fabText || "💬",
                showExampleMessages: config.showExampleMessages !== false, // Default true
                exampleMessages: config.exampleMessages || [

                    "Book a consultation",
                    "Check appointment availability",
                    "Reschedule my appointment",
                    "Cancel my appointment"
                ],
                includeMessageHistory: config.includeMessageHistory !== false, // Default true
                maxHistoryMessages: config.maxHistoryMessages || 20
            }

            this.isVisible = false
            this.isConnected = false
            this.isLoading = false
            this.socket = null
            this.messageId = 0
            this.audioContext = null
            this.messageHistory = [] // Store message history in OpenAI format

            this.init()
        }

        init() {
            this.createAudioContext()
            this.createStyles()
            this.createFAB()
            this.createChatWindow()
            this.bindEvents()
            this.playInitSound()

            if (this.config.apiUrl) {
                this.connectWebSocket()
            }
        }

        // Simple markdown parser for chat messages
        parseMarkdown(text) {
            // Convert markdown to HTML
            let html = text
                // Bold: **text** or __text__
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.*?)__/g, '<strong>$1</strong>')
                // Italic: *text* or _text_
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/_(.*?)_/g, '<em>$1</em>')
                // Bold italic: ***text***
                .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
                // Code: `text`
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                // Links: [text](url)
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
                // Line breaks
                .replace(/\n/g, '<br>')

            // Handle headers (### Header)
            html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
            html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
            html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')

            // Handle lists
            const lines = html.split('<br>')
            const processedLines = []
            let inList = false
            let listItems = []

            for (let line of lines) {
                const trimmedLine = line.trim()

                // Check for bullet points (-, +, *, or numbered)
                if (/^[-+*]\s+/.test(trimmedLine) || /^\d+\.\s+/.test(trimmedLine)) {
                    const isNumbered = /^\d+\.\s+/.test(trimmedLine)
                    const content = trimmedLine.replace(/^[-+*\d+.]\s+/, '')

                    if (!inList) {
                        inList = true
                        listItems = []
                    }
                    listItems.push({ content, numbered: isNumbered })
                } else {
                    // End of list, process accumulated items
                    if (inList) {
                        const hasNumbered = listItems.some(item => item.numbered)
                        const listTag = hasNumbered ? 'ol' : 'ul'
                        const listHtml = `<${listTag}>${listItems.map(item => `<li>${item.content}</li>`).join('')}</${listTag}>`
                        processedLines.push(listHtml)
                        inList = false
                        listItems = []
                    }

                    if (trimmedLine) {
                        processedLines.push(line)
                    }
                }
            }

            // Handle any remaining list items
            if (inList && listItems.length > 0) {
                const hasNumbered = listItems.some(item => item.numbered)
                const listTag = hasNumbered ? 'ol' : 'ul'
                const listHtml = `<${listTag}>${listItems.map(item => `<li>${item.content}</li>`).join('')}</${listTag}>`
                processedLines.push(listHtml)
            }

            return processedLines.join('<br>')
        }

        createAudioContext() {
            try {
                this.audioContext = new (window.AudioContext ||
                    window.webkitAudioContext)()
            } catch (error) {
                console.warn("AiAgent: Audio not supported")
            }
        }

        playSound(frequency = 800, duration = 150, volume = 0.1) {
            if (!this.audioContext) return

            try {
                const oscillator = this.audioContext.createOscillator()
                const gainNode = this.audioContext.createGain()

                oscillator.connect(gainNode)
                gainNode.connect(this.audioContext.destination)

                oscillator.frequency.setValueAtTime(
                    frequency,
                    this.audioContext.currentTime
                )
                oscillator.type = "sine"

                gainNode.gain.setValueAtTime(0, this.audioContext.currentTime)
                gainNode.gain.linearRampToValueAtTime(
                    volume,
                    this.audioContext.currentTime + 0.01
                )
                gainNode.gain.exponentialRampToValueAtTime(
                    0.001,
                    this.audioContext.currentTime + duration / 1000
                )

                oscillator.start(this.audioContext.currentTime)
                oscillator.stop(this.audioContext.currentTime + duration / 1000)
            } catch (error) {
                console.warn("AiAgent: Could not play sound")
            }
        }

        playInitSound() {
            setTimeout(() => this.playSound(600, 200, 0.05), 100)
        }

        playMessageSound() {
            if (!this.isVisible) {
                this.playSound(800, 150, 0.08)
            }
        }

        createStyles() {
            const fabColor = this.config.fabColor || this.config.primaryColor
            const style = document.createElement("style")
            style.textContent = `
                .aiagent-fab {
                    position: fixed;
                    bottom: 16px;
                    right: 16px;
                    background: ${fabColor};
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    cursor: pointer;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    z-index: 1000;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 500;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }

                .aiagent-fab.is-text {
                    border-radius: 24px;
                    padding: 8px 16px;
                    min-width: 48px;
                    height: 48px;
                    font-size: 14px;
                    white-space: nowrap;
                }

                .aiagent-fab.is-icon {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    font-size: 18px;
                }

                .aiagent-fab:hover {
                    background: ${this.config.secondaryColor};
                    transform: scale(1.05);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }

                .aiagent-fab:focus {
                    outline: 2px solid ${this.config.primaryColor};
                    outline-offset: 2px;
                }

                .aiagent-fab.has-notification::after {
                    content: '';
                    position: absolute;
                    top: -2px;
                    right: -2px;
                    width: 12px;
                    height: 12px;
                    background: #ff4444;
                    border: 2px solid white;
                    border-radius: 50%;
                    animation: pulse 2s infinite;
                }

                .aiagent-fab.is-text.has-notification::after {
                    top: -4px;
                    right: -4px;
                }

                @keyframes pulse {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }

                .aiagent-window {
                    position: fixed;
                    bottom: 70px;
                    right: 16px;
                    width: 320px;
                    height: 420px;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    z-index: 999;
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px;
                }

                .aiagent-window.visible {
                    display: flex;
                    animation: slideUp 0.2s ease-out;
                }

                @keyframes slideUp {
                    from {
                        transform: translateY(10px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }

                .aiagent-header {
                    background: ${this.config.primaryColor};
                    color: white;
                    padding: 12px 14px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    min-height: 44px;
                }

                .aiagent-agent-info h3 {
                    margin: 0;
                    font-size: 14px;
                    font-weight: 600;
                    line-height: 1.2;
                }

                .aiagent-agent-info p {
                    margin: 2px 0 0 0;
                    font-size: 11px;
                    opacity: 0.85;
                    line-height: 1.2;
                }

                .aiagent-header-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .aiagent-clear-btn {
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    border-radius: 4px;
                    padding: 4px 8px;
                    font-size: 10px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-family: inherit;
                }

                .aiagent-clear-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    border-color: rgba(255, 255, 255, 0.5);
                }

                .aiagent-status {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 10px;
                }

                .aiagent-status-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #ff4444;
                    transition: background-color 0.3s ease;
                }

                .aiagent-status-dot.connected {
                    background: #44ff44;
                }

                .aiagent-messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px;
                    background: #fafafa;
                    scroll-behavior: smooth;
                }

                .aiagent-messages::-webkit-scrollbar {
                    width: 4px;
                }

                .aiagent-messages::-webkit-scrollbar-track {
                    background: transparent;
                }

                .aiagent-messages::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 2px;
                }

                .aiagent-message {
                    margin-bottom: 8px;
                    display: flex;
                    align-items: flex-start;
                    gap: 6px;
                }

                .aiagent-message.user {
                    flex-direction: row-reverse;
                }

                .aiagent-message-bubble {
                    max-width: 75%;
                    padding: 8px 12px;
                    border-radius: 12px;
                    font-size: 13px;
                    line-height: 1.4;
                    word-wrap: break-word;
                }

                .aiagent-message.user .aiagent-message-bubble {
                    background: ${this.config.primaryColor};
                    color: white;
                    border-bottom-right-radius: 3px;
                }

                .aiagent-message.assistant .aiagent-message-bubble {
                    background: ${this.config.chatBubbleColor};
                    color: #333;
                    border: 1px solid rgba(0, 0, 0, 0.08);
                    border-bottom-left-radius: 3px;
                }

                /* Markdown styling within message bubbles */
                .aiagent-message-bubble h1,
                .aiagent-message-bubble h2,
                .aiagent-message-bubble h3 {
                    margin: 8px 0 4px 0;
                    font-weight: 600;
                }

                .aiagent-message-bubble h1 {
                    font-size: 16px;
                    color: ${this.config.primaryColor};
                }

                .aiagent-message-bubble h2 {
                    font-size: 15px;
                    color: ${this.config.primaryColor};
                }

                .aiagent-message-bubble h3 {
                    font-size: 14px;
                    color: ${this.config.primaryColor};
                }

                .aiagent-message-bubble strong {
                    font-weight: 600;
                    color: inherit;
                }

                .aiagent-message-bubble em {
                    font-style: italic;
                }

                .aiagent-message-bubble code {
                    background: rgba(0, 0, 0, 0.1);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
                    font-size: 12px;
                }

                .aiagent-message-bubble ul,
                .aiagent-message-bubble ol {
                    margin: 8px 0;
                    padding-left: 16px;
                }

                .aiagent-message-bubble li {
                    margin: 4px 0;
                    line-height: 1.4;
                }

                .aiagent-message-bubble a {
                    color: ${this.config.primaryColor};
                    text-decoration: none;
                    border-bottom: 1px solid currentColor;
                }

                .aiagent-message-bubble a:hover {
                    opacity: 0.8;
                }

                .aiagent-message.user .aiagent-message-bubble h1,
                .aiagent-message.user .aiagent-message-bubble h2,
                .aiagent-message.user .aiagent-message-bubble h3 {
                    color: rgba(255, 255, 255, 0.9);
                }

                .aiagent-message.user .aiagent-message-bubble code {
                    background: rgba(255, 255, 255, 0.2);
                    color: white;
                }

                .aiagent-message.user .aiagent-message-bubble a {
                    color: rgba(255, 255, 255, 0.9);
                }

                .aiagent-input-area {
                    padding: 10px 12px;
                    border-top: 1px solid #e5e5e5;
                    background: white;
                    display: flex;
                    gap: 6px;
                    align-items: self-start;
                }

                .aiagent-input-container {
                    flex: 1;
                    position: relative;
                }

                .aiagent-input {
                    width: 100%;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    padding: 8px 12px;
                    font-size: 13px;
                    resize: none;
                    outline: none;
                    font-family: inherit;
                    max-height: 80px;
                    min-height: 18px;
                    box-sizing: border-box;
                }

                .aiagent-input:focus {
                    border-color: ${this.config.primaryColor};
                    box-shadow: 0 0 0 1px ${this.config.primaryColor}40;
                }

                .aiagent-send-btn {
                    width: 32px;
                    height: 32px;
                    background: ${this.config.primaryColor};
                    border: none;
                    border-radius: 50%;
                    color: white;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                    transition: all 0.2s ease;
                    flex-shrink: 0;
                }

                .aiagent-send-btn:hover:not(:disabled) {
                    background: ${this.config.secondaryColor};
                    transform: scale(1.05);
                }

                .aiagent-send-btn:disabled {
                    background: #ccc;
                    cursor: not-allowed;
                    transform: none;
                }

                .aiagent-loading {
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 12px;
                }

                .aiagent-loading.visible {
                    display: flex;
                }

                .aiagent-loading-spinner {
                    width: 20px;
                    height: 20px;
                    border: 2px solid #e5e5e5;
                    border-top: 2px solid ${this.config.primaryColor};
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }

                .aiagent-loading-text {
                    margin-left: 8px;
                    font-size: 12px;
                    color: #666;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                .aiagent-typing {
                    display: flex;
                    align-items: center;
                    gap: 3px;
                    padding: 8px 12px;
                    background: ${this.config.chatBubbleColor};
                    border-radius: 12px;
                    border-bottom-left-radius: 3px;
                    max-width: 60px;
                }

                .aiagent-typing-dot {
                    width: 3px;
                    height: 3px;
                    background: #666;
                    border-radius: 50%;
                    animation: typing 1.4s infinite ease-in-out;
                }

                .aiagent-typing-dot:nth-child(2) {
                    animation-delay: 0.2s;
                }

                .aiagent-typing-dot:nth-child(3) {
                    animation-delay: 0.4s;
                }

                @keyframes typing {
                    0%, 60%, 100% {
                        transform: translateY(0);
                        opacity: 0.4;
                    }
                    30% {
                        transform: translateY(-6px);
                        opacity: 1;
                    }
                }

                .aiagent-empty-state {
                    text-align: center;
                    padding: 20px;
                    color: #666;
                    font-size: 12px;
                }

                .aiagent-empty-state-icon {
                    font-size: 24px;
                    margin-bottom: 8px;
                    opacity: 0.5;
                }

                .aiagent-example-messages {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    margin-top: 12px;
                }

                .aiagent-example-message {
                    background: white;
                    border: 1px solid #e5e5e5;
                    border-radius: 8px;
                    padding: 8px 12px;
                    font-size: 12px;
                    text-align: left;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    color: #666;
                }

                .aiagent-example-message:hover {
                    background: #f8f8f8;
                    border-color: ${this.config.primaryColor};
                    color: ${this.config.primaryColor};
                    transform: translateY(-1px);
                }

                @media (max-width: 480px) {
                    .aiagent-window {
                        width: calc(100vw - 16px);
                        height: calc(100vh - 32px);
                        bottom: 8px;
                        right: 8px;
                        border-radius: 6px;
                    }

                    .aiagent-fab {
                        bottom: 12px;
                        right: 12px;
                    }

                    .aiagent-fab.is-icon {
                        width: 44px;
                        height: 44px;
                        font-size: 16px;
                    }

                    .aiagent-fab.is-text {
                        height: 44px;
                        padding: 6px 12px;
                        font-size: 13px;
                    }

                    .aiagent-header {
                        padding: 10px 12px;
                    }

                    .aiagent-messages {
                        padding: 10px;
                    }

                    .aiagent-input-area {
                        padding: 8px 10px;
                    }
                }
            `
            document.head.appendChild(style)
        }

        createFAB() {
            this.fab = document.createElement("button")
            this.fab.className = "aiagent-fab"
            this.fab.innerHTML = this.config.fabText
            this.fab.setAttribute("aria-label", "Open chat")
            this.fab.setAttribute("aria-expanded", "false")

            // Determine if FAB text is an emoji/icon or actual text
            const isTextualContent =
                this.config.fabText.length > 2 ||
                !/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
                    this.config.fabText
                )

            if (isTextualContent) {
                this.fab.classList.add("is-text")
            } else {
                this.fab.classList.add("is-icon")
            }

            document.body.appendChild(this.fab)
        }

        createChatWindow() {
            this.chatWindow = document.createElement("div")
            this.chatWindow.className = "aiagent-window"
            this.chatWindow.setAttribute("role", "dialog")
            this.chatWindow.setAttribute("aria-labelledby", "aiagent-title")

            // Header
            const header = document.createElement("div")
            header.className = "aiagent-header"

            const agentInfo = document.createElement("div")
            agentInfo.className = "aiagent-agent-info"

            const agentName = document.createElement("h3")
            agentName.id = "aiagent-title"
            agentName.textContent = this.config.agentName

            const agentTitle = document.createElement("p")
            agentTitle.textContent = this.config.agentTitle

            agentInfo.appendChild(agentName)
            agentInfo.appendChild(agentTitle)

            // Header actions container
            const headerActions = document.createElement("div")
            headerActions.className = "aiagent-header-actions"

            // Clear chat button
            this.clearButton = document.createElement("button")
            this.clearButton.className = "aiagent-clear-btn"
            this.clearButton.innerHTML = "Clear"
            this.clearButton.setAttribute("aria-label", "Clear chat history")
            this.clearButton.style.display = "none" // Hidden initially

            const status = document.createElement("div")
            status.className = "aiagent-status"

            this.statusDot = document.createElement("div")
            this.statusDot.className = "aiagent-status-dot"

            this.statusText = document.createElement("span")
            this.statusText.textContent = "Offline"

            status.appendChild(this.statusDot)
            status.appendChild(this.statusText)

            headerActions.appendChild(this.clearButton)
            headerActions.appendChild(status)

            header.appendChild(agentInfo)
            header.appendChild(headerActions)

            // Messages area
            this.messagesContainer = document.createElement("div")
            this.messagesContainer.className = "aiagent-messages"
            this.messagesContainer.setAttribute("role", "log")
            this.messagesContainer.setAttribute("aria-live", "polite")

            // Empty state
            this.createEmptyState()

            // Loading indicator
            this.loadingIndicator = document.createElement("div")
            this.loadingIndicator.className = "aiagent-loading"

            const spinner = document.createElement("div")
            spinner.className = "aiagent-loading-spinner"

            const loadingText = document.createElement("span")
            loadingText.className = "aiagent-loading-text"
            loadingText.textContent = "Thinking..."

            this.loadingIndicator.appendChild(spinner)
            this.loadingIndicator.appendChild(loadingText)

            // Input area
            const inputArea = document.createElement("div")
            inputArea.className = "aiagent-input-area"

            const inputContainer = document.createElement("div")
            inputContainer.className = "aiagent-input-container"

            this.messageInput = document.createElement("textarea")
            this.messageInput.className = "aiagent-input"
            this.messageInput.placeholder = "Type a message..."
            this.messageInput.setAttribute("aria-label", "Message input")
            this.messageInput.rows = 1

            inputContainer.appendChild(this.messageInput)

            this.sendButton = document.createElement("button")
            this.sendButton.className = "aiagent-send-btn"
            this.sendButton.innerHTML = "→"
            this.sendButton.setAttribute("aria-label", "Send message")
            this.sendButton.disabled = true

            inputArea.appendChild(inputContainer)
            inputArea.appendChild(this.sendButton)

            this.chatWindow.appendChild(header)
            this.chatWindow.appendChild(this.messagesContainer)
            this.chatWindow.appendChild(this.loadingIndicator)
            this.chatWindow.appendChild(inputArea)

            document.body.appendChild(this.chatWindow)
        }

        createEmptyState() {
            this.emptyState = document.createElement("div")
            this.emptyState.className = "aiagent-empty-state"

            const icon = document.createElement("div")
            icon.className = "aiagent-empty-state-icon"
            icon.textContent = "👋"

            const text = document.createElement("div")
            text.textContent = `Hi! I'm ${this.config.agentName}. How can I help you today?`

            this.emptyState.appendChild(icon)
            this.emptyState.appendChild(text)

            // Add example messages if enabled
            if (this.config.showExampleMessages && this.config.exampleMessages.length > 0) {
                const exampleContainer = document.createElement("div")
                exampleContainer.className = "aiagent-example-messages"

                this.config.exampleMessages.forEach(message => {
                    const exampleBtn = document.createElement("button")
                    exampleBtn.className = "aiagent-example-message"
                    exampleBtn.textContent = message
                    exampleBtn.addEventListener("click", () => {
                        this.messageInput.value = message
                        this.adjustTextareaHeight()
                        this.sendButton.disabled = false
                        this.messageInput.focus()
                    })
                    exampleContainer.appendChild(exampleBtn)
                })

                this.emptyState.appendChild(exampleContainer)
            }

            this.messagesContainer.appendChild(this.emptyState)
        }

        bindEvents() {
            // FAB click
            this.fab.addEventListener("click", () => {
                this.toggleChatWindow()
            })

            // Clear button click
            this.clearButton.addEventListener("click", () => {
                this.clearChat()
            })

            // Input events
            this.messageInput.addEventListener("input", () => {
                this.adjustTextareaHeight()
                this.sendButton.disabled =
                    !this.messageInput.value.trim() || this.isLoading
            })

            this.messageInput.addEventListener("keydown", e => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    this.sendMessage()
                }
            })

            this.sendButton.addEventListener("click", () => {
                this.sendMessage()
            })

            // Close on escape
            document.addEventListener("keydown", e => {
                if (e.key === "Escape" && this.isVisible) {
                    this.toggleChatWindow()
                }
            })

            // Handle visibility change for notification sounds
            document.addEventListener("visibilitychange", () => {
                this.isDocumentVisible = !document.hidden
            })
        }

        adjustTextareaHeight() {
            this.messageInput.style.height = "auto"
            this.messageInput.style.height =
                Math.min(this.messageInput.scrollHeight, 80) + "px"
        }

        toggleChatWindow() {
            this.isVisible = !this.isVisible

            if (this.isVisible) {
                this.chatWindow.classList.add("visible")
                this.fab.innerHTML = "✕"
                this.fab.classList.remove("has-notification")
                this.fab.setAttribute("aria-expanded", "true")
                // Temporarily switch to icon mode when showing close button
                this.fab.classList.add("is-icon")
                this.fab.classList.remove("is-text")
                setTimeout(() => this.messageInput.focus(), 200)
            } else {
                this.chatWindow.classList.remove("visible")
                this.fab.innerHTML = this.config.fabText
                this.fab.setAttribute("aria-expanded", "false")
                // Restore original FAB styling
                const isTextualContent =
                    this.config.fabText.length > 2 ||
                    !/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
                        this.config.fabText
                    )

                if (isTextualContent) {
                    this.fab.classList.add("is-text")
                    this.fab.classList.remove("is-icon")
                } else {
                    this.fab.classList.add("is-icon")
                    this.fab.classList.remove("is-text")
                }
            }
        }

        clearChat() {
            // Clear the UI
            this.messagesContainer.innerHTML = ""
            this.createEmptyState()

            // Clear message history
            this.messageHistory = []

            // Hide clear button
            this.clearButton.style.display = "none"

            // Play a soft sound
            this.playSound(400, 100, 0.03)
        }

        connectWebSocket() {
            if (!this.config.apiUrl) {
                console.warn("AiAgent: No API URL provided")
                return
            }

            try {
                this.socket = new WebSocket(this.config.apiUrl)

                this.socket.onopen = () => {
                    this.isConnected = true
                    this.updateConnectionStatus()
                    console.log("AiAgent: WebSocket connected")

                    // Send initial connection message with agent ID
                    this.socket.send(
                        JSON.stringify({
                            type: "connect",
                            agentId: this.config.agentId,
                            timestamp: Date.now(),
                        })
                    )
                }

                this.socket.onmessage = event => {
                    try {
                        const data = JSON.parse(event.data)
                        this.handleIncomingMessage(data)
                    } catch (error) {
                        console.error("AiAgent: Error parsing message:", error)
                    }
                }

                this.socket.onclose = event => {
                    this.isConnected = false
                    this.updateConnectionStatus()
                    console.log("AiAgent: WebSocket disconnected")

                    // Attempt to reconnect after 3 seconds if not intentional
                    if (!event.wasClean) {
                        setTimeout(() => {
                            this.connectWebSocket()
                        }, 3000)
                    }
                }

                this.socket.onerror = error => {
                    console.error("AiAgent: WebSocket error:", error)
                    this.isConnected = false
                    this.updateConnectionStatus()
                }
            } catch (error) {
                console.error("AiAgent: Failed to connect WebSocket:", error)
                this.updateConnectionStatus()
            }
        }

        updateConnectionStatus() {
            if (this.isConnected) {
                this.statusDot.classList.add("connected")
                this.statusText.textContent = "Online"
            } else {
                this.statusDot.classList.remove("connected")
                this.statusText.textContent = "Offline"
            }
        }

        showLoading() {
            this.isLoading = true
            this.loadingIndicator.classList.add("visible")
            this.sendButton.disabled = true
            this.scrollToBottom()
        }

        hideLoading() {
            this.isLoading = false
            this.loadingIndicator.classList.remove("visible")
            this.sendButton.disabled = !this.messageInput.value.trim()
        }

        addToHistory(role, content) {
            if (!this.config.includeMessageHistory) return

            this.messageHistory.push({
                role: role,
                content: content
            })

            // Keep only the last N messages
            const maxMessages = this.config.maxHistoryMessages
            if (this.messageHistory.length > maxMessages) {
                this.messageHistory = this.messageHistory.slice(-maxMessages)
            }
        }

        getMessageHistory() {
            if (!this.config.includeMessageHistory) {
                return []
            }

            return this.messageHistory
        }

        sendMessage() {
            const message = this.messageInput.value.trim()
            if (!message || this.isLoading) return

            // Hide empty state on first message
            if (this.emptyState && this.emptyState.parentNode) {
                this.emptyState.remove()
                this.clearButton.style.display = "block" // Show clear button when chat starts
            }

            // Add to history and UI
            this.addToHistory("user", message)
            this.addMessage(message, "user")
            this.messageInput.value = ""
            this.adjustTextareaHeight()
            this.showLoading()

            if (this.socket && this.isConnected) {
                const messageData = {
                    type: "message",
                    content: message,
                    agentId: this.config.agentId,
                    messageId: ++this.messageId,
                    timestamp: Date.now(),
                    // Include message history in OpenAI format
                    history: this.getMessageHistory()
                }

                this.socket.send(JSON.stringify(messageData))
            } else {
                // Simulate response when not connected
                setTimeout(() => {
                    this.hideLoading()
                    const responseMessage = "I'm currently offline. Please try again later."
                    this.addToHistory("assistant", responseMessage)
                    this.addMessage(responseMessage, "assistant")
                    this.playMessageSound()
                }, 1500)
            }
        }

        handleIncomingMessage(data) {
            this.hideLoading()
            this.hideTyping()

            switch (data.type) {
                case "message":
                    this.addToHistory("assistant", data.content)
                    this.addMessage(data.content, "assistant")
                    this.playMessageSound()
                    if (!this.isVisible) {
                        this.fab.classList.add("has-notification")
                    }
                    break
                case "typing":
                    if (data.isTyping) {
                        this.showTyping()
                    } else {
                        this.hideTyping()
                    }
                    break
                case "error":
                    console.error("AiAgent: Server error:", data.message)
                    const errorMessage = "Sorry, there was an error processing your message."
                    this.addToHistory("assistant", errorMessage)
                    this.addMessage(errorMessage, "assistant")
                    break
            }
        }

        addMessage(content, sender) {
            const messageDiv = document.createElement("div")
            messageDiv.className = `aiagent-message ${sender}`

            const bubble = document.createElement("div")
            bubble.className = "aiagent-message-bubble"

            // Use innerHTML for assistant messages to render markdown, textContent for user messages
            if (sender === "assistant") {
                bubble.innerHTML = this.parseMarkdown(content)
            } else {
                bubble.textContent = content
            }

            messageDiv.appendChild(bubble)
            this.messagesContainer.appendChild(messageDiv)
            this.scrollToBottom()
        }

        showTyping() {
            if (this.typingIndicator) return

            this.typingIndicator = document.createElement("div")
            this.typingIndicator.className = "aiagent-message assistant"

            const bubble = document.createElement("div")
            bubble.className = "aiagent-typing"

            for (let i = 0; i < 3; i++) {
                const dot = document.createElement("div")
                dot.className = "aiagent-typing-dot"
                bubble.appendChild(dot)
            }

            this.typingIndicator.appendChild(bubble)
            this.messagesContainer.appendChild(this.typingIndicator)
            this.scrollToBottom()
        }

        hideTyping() {
            if (this.typingIndicator) {
                this.typingIndicator.remove()
                this.typingIndicator = null
            }
        }

        scrollToBottom() {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight
        }

        // Public methods for external control
        sendProgrammaticMessage(message) {
            if (!message || typeof message !== 'string') return

            this.messageInput.value = message
            this.adjustTextareaHeight()
            this.sendMessage()
        }

        getConversationHistory() {
            return this.getMessageHistory()
        }

        destroy() {
            if (this.socket) {
                this.socket.close()
            }

            if (this.audioContext) {
                this.audioContext.close()
            }

            if (this.fab) {
                this.fab.remove()
            }

            if (this.chatWindow) {
                this.chatWindow.remove()
            }
        }
    }

    // Auto-initialize from script tag data attributes
    function initializeAiAgent() {
        const scripts = document.querySelectorAll(
            "script[data-agent-id], script[data-api-url]"
        )
        const currentScript = scripts[scripts.length - 1] || document.currentScript

        if (!currentScript) {
            console.warn("AiAgent: Could not find script tag with data attributes")
            return
        }

        const config = {
            agentId: currentScript.getAttribute("data-agent-id"),
            primaryColor: currentScript.getAttribute("data-primary-color"),
            secondaryColor: currentScript.getAttribute("data-secondary-color"),
            chatBubbleColor: currentScript.getAttribute("data-chat-bubble-color"),
            agentName: currentScript.getAttribute("data-agent-name"),
            agentTitle: currentScript.getAttribute("data-agent-title"),
            apiUrl: currentScript.getAttribute("data-api-url"),
            fabColor: currentScript.getAttribute("data-fab-color"),
            fabText: currentScript.getAttribute("data-fab-text"),
            showExampleMessages: currentScript.getAttribute("data-show-example-messages") !== "false",
            includeMessageHistory: currentScript.getAttribute("data-include-message-history") !== "false",
            maxHistoryMessages: parseInt(currentScript.getAttribute("data-max-history-messages")) || 20
        }

        // Parse example messages from JSON if provided
        const exampleMessagesAttr = currentScript.getAttribute("data-example-messages")
        if (exampleMessagesAttr) {
            try {
                config.exampleMessages = JSON.parse(exampleMessagesAttr)
            } catch (error) {
                console.warn("AiAgent: Invalid JSON in data-example-messages")
            }
        }

        // Remove null/undefined values
        Object.keys(config).forEach(key => {
            if (config[key] === null) {
                delete config[key]
            }
        })

        const agent = new AiAgentPlugin(config)

        // Expose agent instance globally for external access
        window.aiAgent = agent

        return agent
    }

    // Initialize when DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAiAgent)
    } else {
        initializeAiAgent()
    }

    // Export for manual initialization if needed
    window.AiAgentPlugin = AiAgentPlugin
})()