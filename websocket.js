from gevent import monkey
monkey.patch_all()

import os
import json
from pymongo import MongoClient
from flask import Flask
from flask_sock import Sock
import threading
from dotenv import load_dotenv

# ---------------- Configuration ----------------
load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")
WATCH_STATIONS = ["rename", "nebula", "armirror"]

# ---------------- Flask + WebSocket setup ----------------
app = Flask(__name__)
sock = Sock(app)

# Connected WebSocket clients
clients = {station: set() for station in WATCH_STATIONS}

# ---------------- WebSocket Route ----------------
@sock.route("/ws/<station>")
def ws_station(ws, station):
    if station not in clients:
        ws.close()
        return

    clients[station].add(ws)
    print(f"✅ Client connected to {station}, total:", len(clients[station]))
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
    finally:
        clients[station].discard(ws)
        print(f"❌ Client disconnected from {station}, total:", len(clients[station]))

# ---------------- Mongo Watcher ----------------
def watch_mongo():
    client = MongoClient(MONGO_URI)
    coll = client.test.events
    print(f"👀 Watching MongoDB for stations: {WATCH_STATIONS}")
    pipeline = [{"$match": {"fullDocument.stationId": {"$in": WATCH_STATIONS}}}]
    for change in coll.watch(pipeline, full_document="updateLookup"):
        doc = change["fullDocument"]
        msg = "1" if doc.get("eventType") == "cardDetected" else "0"
        station = doc.get("stationId")
        print(f"📤 Sending {msg} to {station}")
        dead = []
        for ws in clients.get(station, []):
            try:
                ws.send(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients[station].discard(ws)

# ---------------- Spawn watcher ----------------
def start_watchers():
    t = threading.Thread(target=watch_mongo, daemon=True)
    t.start()

# ---------------- Optional health route ----------------
@app.route("/")
def index():
    return "WebSocket server running!"

if __name__ == "__main__":
    start_watchers()
    # Waitress server for Windows / production-like environment
    from waitress import serve
    serve(app, host="0.0.0.0", port=10000)
