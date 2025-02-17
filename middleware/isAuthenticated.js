const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(403).send('Access denied. Please log in.');
    }
};

module.exports = isAuthenticated;