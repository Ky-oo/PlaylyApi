var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var { verifyAuth } = require("./middleware/auth");

const dotenv = require("dotenv");
dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env" : ".env.local",
});

var indexRouter = require("./routes/index");
var userRouter = require("./routes/user");
var organisationRouter = require("./routes/organisation");
var activityRouter = require("./routes/activity");
var paymentRouter = require("./routes/payment");
var chatRouter = require("./routes/chat");
var chatMessageRouter = require("./routes/chatmessage");
var authRouter = require("./routes/auth");
var corsMiddleware = require("./middleware/cors");
var groupRouter = require("./routes/group");

require("./model");

var app = express();

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(corsMiddleware);

app.use("/", indexRouter);
app.use("/auth", authRouter);
app.use("/user", userRouter);
app.use("/organisation", organisationRouter);
app.use("/activity", activityRouter);
app.use("/payment", paymentRouter);

app.use(verifyAuth);

app.use("/chat", chatRouter);
app.use("/chatmessage", chatMessageRouter);
app.use("/group", groupRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  res.status(err.status || 500).json({ error: res.locals.message });
});

module.exports = app;
