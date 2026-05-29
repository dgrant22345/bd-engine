FROM mcr.microsoft.com/powershell:latest

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Expose port (Render/Koyeb override this dynamically via the PORT env var)
EXPOSE 8173

# Start the application server
CMD ["pwsh", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "./server/Server.ps1"]
