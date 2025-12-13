FROM apify/actor-node-playwright-chrome:24

COPY . ./
RUN npm install

CMD ["npm", "run", "start"]
