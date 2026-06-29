# ---------- Frontend build ----------
FROM node:20-slim AS frontend-build

WORKDIR /app

# Install frontend dependencies first for better Docker layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy only the files needed to build the Vite frontend.
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public/ ./public/
COPY src/ ./src/

RUN npm run build


# ---------- Backend runtime ----------
FROM python:3.12-slim

WORKDIR /app

# Install Python runtime dependencies.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code and runtime entry point.
COPY backend/ ./backend/
COPY start.py ./start.py

# Copy the frontend bundle produced in the build stage.
COPY --from=frontend-build /app/dist ./dist

ENV PYTHONPATH=/app/backend
ENV PORT=8080

EXPOSE 8080

# Apply Alembic migrations before starting the web server. This is suitable
# for the single-instance Render deployment defined in render.yaml.
CMD ["sh", "-c", "cd /app/backend && alembic upgrade head && cd /app && python3 start.py"]
