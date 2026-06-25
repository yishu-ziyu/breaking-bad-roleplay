FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/
COPY start.py .

# Copy pre-built frontend
COPY dist/ ./dist/

# Environment
ENV PYTHONPATH=/app/backend
ENV PORT=8080

EXPOSE 8080

CMD ["python3", "start.py"]
