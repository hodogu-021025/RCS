# syntax=docker/dockerfile:1
#
# 주문 챗봇(React/Vite) + nginx 이미지.
# 빌드 컨텍스트는 **저장소 루트** — nginx 설정(deploy/nginx.conf)이 frontend/ 바깥에 있기 때문이다.
# 루트 .dockerignore 가 frontend/ 와 deploy/nginx.conf 만 컨텍스트에 남긴다.
#
#   1) build   : Node 24로 `npm run build` (tsc -b && vite build) → dist/
#   2) runtime : nginx 가 dist/ 를 서빙한다. HTTPS 는 앞단 프록시에서 종료한다.

# --platform=$BUILDPLATFORM: dist/ 는 정적 파일이라 아키텍처와 무관하므로 빌드는 빌드 머신에서 네이티브로 돌리고,
# 런타임 nginx 만 목표 아키텍처(Oracle Ampere A1 이면 arm64)를 쓴다.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY frontend/ ./
# 가게·메뉴 목록은 서버와 같이 쓰는 파일이다 (src 에서 ../../../server/catalog.json 으로 읽는다)
COPY server/catalog.json /server/catalog.json
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
