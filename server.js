const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const bcrypt = require("bcrypt");
const path = require("path");
const jwt = require("jsonwebtoken");
const User = require("./models/userModel");
const Metadata = require("./models/tableMetadataModel");
const TableModel = require("./models/sheetDataModel");

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
let isConnected = false;
async function connectDB() {
    if (isConnected) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000
    });
    isConnected = true;
    console.log("MongoDB Connected");
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET;

// Middleware to authenticate user using JWT
const isAuthenticated = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(403).json({ message: "Access denied" });

    try {
        const decoded = jwt.verify(token.split(" ")[1], JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ message: "Invalid token" });
    }
};

// Set Active Collection
let activeCollection = "defaultCollection";
app.post("/api/setCollection", (req, res) => {
    activeCollection = req.body.collection;
    res.json({ message: `Active collection set to ${activeCollection}` });
});

// Add New Sheet
app.post("/api/addSheet", async (req, res) => {
    await connectDB();
    const { sheetName } = req.body;
    if (!sheetName) return res.status(400).json({ success: false, message: "Sheet name required!" });

    try {
        let metadata = await Metadata.findOne();
        if (!metadata) {
            metadata = new Metadata({ sheetNames: [sheetName] });
        } else if (!metadata.sheetNames.includes(sheetName)) {
            metadata.sheetNames.push(sheetName);
        } else {
            return res.json({ success: false, message: "Sheet already exists!" });
        }
        await metadata.save();
        res.json({ success: true, message: "Sheet added successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Error adding sheet" });
    }
});

// Get Sheets
app.get("/api/getSheets", async (req, res) => {
    await connectDB();
    try {
        let metadata = await Metadata.findOne();
        res.json({ sheets: metadata ? metadata.sheetNames : [] });
    } catch (error) {
        res.status(500).json({ error: "Error fetching sheets" });
    }
});

// Get Table Data
app.get("/api/getTable", async (req, res) => {
    await connectDB();
    try {
        const table = await TableModel.findOne({ collectionName: activeCollection });
        if (!table) return res.json({ metadata: { rows: 5, columns: 5 }, data: [] });
        res.json({ metadata: { rows: table.rows, columns: table.columns }, data: table.data });
    } catch (error) {
        res.status(500).json({ error: "Error fetching table data" });
    }
});

// Save Table Data
app.post("/api/saveTable", async (req, res) => {
    await connectDB();
    const { rows, columns, data } = req.body;
    try {
        await TableModel.findOneAndUpdate(
            { collectionName: activeCollection },
            { rows, columns, data },
            { upsert: true }
        );
        res.json({ message: "Table data saved successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error saving table data" });
    }
});

// Delete Sheet
app.delete("/api/deleteSheet", async (req, res) => {
    await connectDB();
    const { sheetName } = req.body;
    if (!sheetName) return res.status(400).json({ success: false, message: "Sheet name required!" });

    try {
        let metadata = await Metadata.findOne();
        if (metadata) {
            metadata.sheetNames = metadata.sheetNames.filter(name => name !== sheetName);
            await metadata.save();
        }

        const deleteResult = await TableModel.deleteOne({ collectionName: sheetName });
        if (deleteResult.deletedCount > 0) {
            res.json({ success: true, message: `Sheet "${sheetName}" deleted.` });
        } else {
            res.status(404).json({ success: false, message: "Sheet not found!" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal Server Error", error });
    }
});

// User Signup
app.post('/api/signup', async (req, res) => {
    await connectDB();
    const { username, password } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ success: true, message: 'User created' });
});

// User Login (JWT)
app.post('/api/login', async (req, res) => {
    await connectDB();
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Export app for Vercel
module.exports = app;
