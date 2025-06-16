# Use the latest Ubuntu as the base image
FROM ubuntu:latest

# Set environment variables for non-interactive apt-get installs
ENV DEBIAN_FRONTEND=noninteractive

# Update package lists and install Node.js, npm, FFmpeg, and Redis Server
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    ffmpeg \
    redis-server \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /home/hprakash/projects/mycctv

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies explicitly
RUN npm install express ioredis jsonwebtoken

# Copy the rest of your application code
COPY . .

# Declare which network ports the container intends to listen on
EXPOSE 6379
EXPOSE 8080

# --- CHANGE IS HERE ---
# Define the default command to run when a container starts from this image.
# This will simply drop you into a bash shell inside the container.
CMD ["/bin/bash"]