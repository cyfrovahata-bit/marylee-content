FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core zip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
