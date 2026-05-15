FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o server ./cmd/server

FROM alpine:3.18

WORKDIR /app

COPY --from=builder /app/server .
COPY --from=builder /app/data/sellers.json ./data/sellers.json

ENV PORT=8080
ENV DB_PATH=/data/sellerpulse.db
ENV SELLERS_FILE=/app/data/sellers.json
ENV ML_SERVICE_URL=http://ml:8001

EXPOSE 8080

CMD ["./server"]
