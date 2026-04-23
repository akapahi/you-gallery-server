import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();

app.use(cors({
  origin: "http://localhost:3000",
}));

// Middleware
app.use(express.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const stations = ["palm", "rename", "nebula", "armirror", "planar", "rubegoldberg", "printer", "dispenser"]

// ------------------ DEVICE HEALTH ------------------

const deviceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["esp32", "server", "service"],
    required: true,
  },

  stationId: {
    type: String,
    required: true,
  },

  status: {
    type: String,
    enum: ["ok", "warning", "error"],
    default: "ok",
  },

  lastSeen: {
    type: Date,
    default: Date.now,
  },

  metrics: {
    type: Object,
    default: {},
  },

  errors: {
    type: [Object],
    default: [],
  },

  meta: {
    type: Object,
    default: {},
  },
});

// Define a schema & model
const visitorSchema = new mongoose.Schema({
  UID: {
    type: String,
    required: [true, "UID is required"],
  },
  isInside: Boolean,
  appData: { type: Object, default: {} },
});

// Define a schema & model *
const cardSchema = new mongoose.Schema({
  UID: {
    type: String,
    required: [true, "UID is required"],
  },
  Token: Number,
  isCardActive: Boolean,
});

// Define a schema & model
const eventSchema = new mongoose.Schema({
  UID: {
    type: String,
    required: [true, "UID is required"],
  },
  stationId: {
    type: String,
    enum: stations,
    required: [true, "stationId is required"],
  },
  eventType: {
    type: String,
    enum: ["cardDetected", "cardLifted"], 
    required: [true, "eventType is required"],
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const Visitor = mongoose.model("Visitor", visitorSchema);
const Card = mongoose.model("Card", cardSchema);
const Event = mongoose.model("Event", eventSchema);
const Device = mongoose.model("Device", deviceSchema);

const createNewVisitor = async (uid) => {
  const newVisitor = new Visitor({
    UID: uid,
    isInside: true,
    appData: {},
  }); 
  await newVisitor.save();
};

app.post("/card/activate", async (req, res) => {
  try {
    const { UID, Token } = req.body;

    // Check if card already exists
    let card = await Card.findOne({ UID });
    if(card && card.isCardActive)    return res.status(400).json({ error: "card already active" });
    if (card) {
      // Update existing card's status to true
      await createNewVisitor(UID);

      card.isCardActive = true;
      await card.save();
      res.status(200).json({ message: "Card reactivated", card });
    } else {
      // Create new card entry
      await createNewVisitor(UID);
      const newCard = new Card({
        UID,
        Token,
        isCardActive: true,
      });
      await newCard.save();
      res.status(201).json({ message: "New card activated", card: newCard });
    } 
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/card/deactivate", async (req, res) => {
  try {
    const { UID } = req.body;

    // Check if card already exists
    let card = await Card.findOne({ UID });
    let visitor = await Visitor.findOne({ UID });
    
    if(!card) res.status(404).json({ message: "Card not found"});
    if(!card.isCardActive) res.status(404).json({ message: "Card not active"});
    if(!visitor) res.status(404).json({ message: "No visitor associated with this card"});

 
    card.isCardActive = false;
    await card.save();

    visitor.isInside = false;
    visitor.UID = 0;
    await visitor.save();
    res.status(200).json({ message: "card deactivated", visitor , card}); 

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.get("/card/authenticate", async (req, res) => {
  try {
    const { UID } = req.query; // <-- read from query params

    if (!UID) {
      return res.status(400).json({ message: "UID query parameter is required" });
    }
    console.log(UID)
    // Check if card already exists
    const card = await Card.findOne({ UID });

    if (card && card.isCardActive) {
      // Active card found
      return res.status(200).json({ message: "Auth OK", card });
    } else if (card) {
      // Card found but not active
      return res.status(403).json({ message: "Card not active" });
    } else {
      // No card found
      return res.status(404).json({ message: "Card not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/events/add_event", async (req, res) => {
  try {
    const { UID, stationId, eventType } = req.body;

    if (!UID || !stationId || !eventType) {
      return res.status(400).json({
        error: "Missing required fields: UID, stationId, and eventType are required",
      });
    }

    // Check if card already exists
    let card = await Card.findOne({ UID });
    let visitor = await Visitor.findOne({ UID });


    if (!card || !visitor ) {
      return res.status(400).json({
        error: "Unidentified card or visitor",
      });
    }

    if (card && visitor && visitor.isInside && card.isCardActive) {
      // Create new event entry
        const istOffsetMs = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(Date.now() + istOffsetMs);
      
        const newEvent = new Event({
        UID,
        stationId,
        eventType,
        timestamp: istTime,
      });
      await newEvent.save();
      res.status(201).json({ message: "New event added", event: newEvent });
    } else {
      res.status(404).json({ message: "Card not active"});
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/visitors/data", async (req, res) => {
  try {
    const { UID, stationId, data } = req.body;

    if (!UID || !stationId || !data) {
      return res.status(400).json({
        error: "Missing required fields: UID, stationId, and data are required",
      });
    }

    // Check if card already exists
    let card = await Card.findOne({ UID });
    let visitor = await Visitor.findOne({ UID });


    if (!card || !visitor || !stations.includes(stationId)) {
      return res.status(400).json({
        error: "Unidentified card or visitor or stationId",
      });
    }

    if (card && visitor && visitor.isInside && card.isCardActive) {
      if (!visitor.appData) visitor.appData = {};

      // If this station already exists, merge new data into it
      if (visitor.appData[stationId]) {
        visitor.appData[stationId] = {
          ...visitor.appData[stationId],
          ...data,
        };
      } else {
        // Otherwise, add a new key (new station)
        visitor.appData[stationId] = data;
      }
      visitor.markModified("appData");

      await visitor.save();
      res.status(200).json({ message: "Data added", visitor });
    } else {
      res.status(404).json({ message: "Card not active"});
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/visitor/data", async (req, res) => {
  try {
    const {UID, stationId} = req.body;

    if (!UID) {
      return res.status(400).json({
        error: "Missing required fields: UID is required",
      });
    }
    const visitor = await Visitor.findOne({ UID });

    if (!visitor) {
      return res.status(404).json({ error: "Visitor not found" });
    }

    // If no appData exists yet
    if (!visitor.appData || Object.keys(visitor.appData).length === 0) {
      return res.status(200).json({ message: "No appData found", appData: {} });
    }

    // If stationId is provided, return only that station's data
    if (stationId && !stations.includes(stationId)) {
      return res.status(400).json({
        error: "Unidentified card or visitor or stationId",
      });
    }

    if (stationId) {
      const stationData = visitor.appData[stationId];
      if (!stationData) {
        return res
          .status(404)
          .json({ message: `No data found for station ${stationId}` });
      }
      return res.json({
        UID,
        stationId,
        data: stationData,
      });
    }

    // Else return all appData
    res.json({
      UID,
      appData: visitor.appData,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/health", async (req, res) => {
  try {
    const {
      type,
      stationId,
      metrics,
      errors,
      status,
      meta,
    } = req.body;

    if (!type || !stationId) {
      return res.status(400).json({
        error: "Missing required fields: type and stationId",
      });
    }

    await Device.updateOne(
      { type, stationId },
      {
        $set: {
          lastSeen: new Date(),
          metrics: metrics || {},
          errors: errors || [],
          status: status || "ok",
          meta: meta || {},
        },
      },
      { upsert: true }
    );

    res.status(200).json({ message: "Heartbeat received" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", async (req, res) => {
  try {
    const devices = await Device.find({}).lean();

    const now = Date.now();
    const OFFLINE_THRESHOLD_MS = 15_000; // adjust to heartbeat rate

    const result = devices.map((d) => {
      const lastSeenMs = new Date(d.lastSeen).getTime();
      const offline = now - lastSeenMs > OFFLINE_THRESHOLD_MS;

      return {
        type: d.type,
        stationId: d.stationId,
        status: offline ? "offline" : d.status,
        lastSeen: d.lastSeen,
        secondsSinceLastSeen: Math.floor((now - lastSeenMs) / 1000),
        metrics: d.metrics,
        errors: d.errors,
        meta: d.meta,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health/:stationId", async (req, res) => {
  try {
    const { stationId } = req.params;

    const devices = await Device.find({ stationId }).lean();
    if (!devices.length) {
      return res.status(404).json({ message: "No devices found for station" });
    }

    const now = Date.now();
    const OFFLINE_THRESHOLD_MS = 15_000;

    const result = devices.map((d) => {
      const offline = now - new Date(d.lastSeen).getTime() > OFFLINE_THRESHOLD_MS;

      return {
        type: d.type,
        status: offline ? "offline" : d.status,
        lastSeen: d.lastSeen,
        secondsSinceLastSeen: Math.floor((now - new Date(d.lastSeen).getTime()) / 1000),
        metrics: d.metrics,
        errors: d.errors,
      };
    });

    res.json({
      stationId,
      devices: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));