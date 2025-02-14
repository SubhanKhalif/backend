const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config(); // Load environment variables from .env
const bcrypt = require('bcrypt');
const path = require('path');
const session = require("express-session");
const isAuthenticated = require('./middleware/isAuthenticated');

// पहले express app को initialize करें
const app = express();
app.use(cors());
app.use(express.json());

// Define the User schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});

// Session management को app initialize के बाद सेट करें
app.use(session({
    secret: process.env.SESSION_SECRET, // .env से secret का उपयोग करें
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // HTTPS के लिए true सेट करें
}));

const User = mongoose.model('User', userSchema);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // Timeout सेट करें
}).then(() => console.log("MongoDB Atlas से कनेक्ट हुआ"))
  .catch(err => {
      console.error("MongoDB कनेक्शन त्रुटि:", err);
      process.exit(1); // कनेक्शन फेल होने पर बंद करें
  });

app.get('/protected-route', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/protected-file.html'));
});

let activeCollection = "defaultCollection";

// Metadata schema for sheets
const metadataSchema = new mongoose.Schema({
    sheetNames: [String],  
});

const Metadata = mongoose.model("TableMetadata", metadataSchema);

// Set active collection
app.post("/api/setCollection", (req, res) => {
    activeCollection = req.body.collection;
    res.json({ message: `Active collection set to ${activeCollection}` });
});

// Add new sheet
app.post("/api/addSheet", async (req, res) => {
    const { sheetName } = req.body;

    if (!sheetName) {
        return res.status(400).json({ success: false, message: "Sheet name is required!" });
    }

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

// Get all available sheets
app.get("/api/getSheets", async (req, res) => {
    try {
        let metadata = await Metadata.findOne();
        res.json({ sheets: metadata ? metadata.sheetNames : [] });
    } catch (error) {
        res.status(500).json({ error: "Error fetching sheets" });
    }
});

// Table data schema
const tableSchema = new mongoose.Schema({
    collectionName: String,
    rows: Number,
    columns: Number,
    data: [
        {
            row: Number,
            col: Number,
            value: String,
        },
    ],
});
const TableModel = mongoose.model("SheetData", tableSchema);

// Fetch table data
app.get("/api/getTable", async (req, res) => {
    try {
        const table = await TableModel.findOne({ collectionName: activeCollection });

        if (!table) {
            return res.json({ metadata: { rows: 5, columns: 5 }, data: [] });
        }

        res.json({ metadata: { rows: table.rows, columns: table.columns }, data: table.data });
    } catch (error) {
        res.status(500).json({ error: "Error fetching table data" });
    }
});

// Save or update table data
app.post("/api/saveTable", async (req, res) => {
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

// DELETE Sheet API
app.delete("/api/deleteSheet", async (req, res) => {
    const { sheetName } = req.body;

    if (!sheetName) {
        return res.status(400).json({ success: false, message: "Sheet name is required!" });
    }

    try {
        // Step 1: Remove sheet name from metadata
        let metadata = await Metadata.findOne();
        if (metadata) {
            metadata.sheetNames = metadata.sheetNames.filter(name => name !== sheetName);
            await metadata.save();
        }

        // Step 2: Delete sheet data from "SheetData" collection
        const deleteResult = await TableModel.deleteOne({ collectionName: sheetName });

        if (deleteResult.deletedCount > 0) {
            res.json({ success: true, message: `Sheet "${sheetName}" deleted successfully.` });
        } else {
            res.status(404).json({ success: false, message: "Sheet not found!" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Internal Server Error", error });
    }
});

// Signup route
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;

    // यूजर पहले से मौजूद है या नहीं चेक करें
    const existingUser = await User.findOne({ username });
    if (existingUser) {
        return res.status(400).send('यूजर पहले से मौजूद है');
    }

    // पासवर्ड को हैश करें
    const hashedPassword = await bcrypt.hash(password, 10);

    // हैश किए गए पासवर्ड के साथ नया यूजर बनाएं
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).send('यूजर बनाया गया');
});

// Login route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user) {
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.user = user; // Set the session
            console.log('User session set:', req.session.user); // Log session
            res.redirect('/index'); // Redirect to index.html
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } else {
        res.status(401).json({ success: false, message: 'User not found' });
    }
});

// Protect the index route with authentication
app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/getTable', (req, res) => {
    try {
        const table = TableModel.findOne({ collectionName: activeCollection });

        if (!table) {
            return res.json({ metadata: { rows: 5, columns: 5 }, data: [] });
        }

        res.json({ metadata: { rows: table.rows, columns: table.columns }, data: table.data });
    } catch (error) {
        res.status(500).json({ error: "Error fetching table data" });
    }
});

app.post('/api/saveTable', (req, res) => {
    const { rows, columns, data } = req.body;
    try {
        TableModel.findOneAndUpdate(
            { collectionName: activeCollection },
            { rows, columns, data },
            { upsert: true }
        );
        res.json({ message: "Table data saved successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error saving table data" });
    }
});

// Default route
app.get("/", (req, res) => {
    res.send("API is running!");
});

// सर्वर को 5000 पोर्ट पर शुरू करें
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`सर्वर ${PORT} पोर्ट पर चल रहा है`);
});

// Export app for Vercel
module.exports = app;
