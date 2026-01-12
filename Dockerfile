FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

COPY . ./
RUN npm install --production

ENV NODE_ENV=production

CMD ["npm", "run", "book"]
