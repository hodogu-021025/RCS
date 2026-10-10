# Saylo API 서버 (이메일 인증). 외부 패키지가 없어 파일만 복사하면 된다.
# RESEND_API_KEY · MAIL_FROM 은 docker-compose 가 저장소 루트의 .env 에서 넣어 준다.
FROM node:24-alpine
WORKDIR /app
COPY package.json *.mjs ./
ENV NODE_ENV=production PORT=3001
USER node
EXPOSE 3001
CMD ["node", "index.mjs"]
