FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV DB_PATH=/data/sellerpulse.db
ENV MODEL_PATH=/app/model.joblib
ENV STATS_PATH=/app/model_stats.json

EXPOSE 8001

CMD ["python", "service.py"]
