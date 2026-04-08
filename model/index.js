const sequelize = require("../orm");
const User = require("./User");
const Organisation = require("./Organisation");
const Activity = require("./Activity");
const GuestUser = require("./GuestUser");
const GuestUserActivity = require("./GuestUserActivity");
const Chat = require("./Chat");
const ChatMessage = require("./ChatMessage");
const ChatMessageSeen = require("./ChatMessageSeen");
const Payment = require("./Payment");
const ParticipationRequest = require("./ParticipationRequest");
const Group = require("./Group");
const GroupMember = require("./GroupMember");
const GroupMessage = require("./GroupMessage");

Organisation.belongsTo(User, {
  foreignKey: "ownerId",
  onDelete: "CASCADE",
});

Activity.belongsTo(Organisation, {
  foreignKey: "hostOrganisationId",
  as: "hostOrganisation",
  onDelete: "CASCADE",
});
Organisation.hasMany(Activity, {
  foreignKey: "hostOrganisationId",
  as: "hostedActivities",
  onDelete: "CASCADE",
});

Activity.belongsTo(User, {
  foreignKey: "hostUserId",
  as: "hostUser",
  onDelete: "CASCADE",
});
User.hasMany(Activity, {
  foreignKey: "hostUserId",
  as: "hostedActivities",
  onDelete: "CASCADE",
});

User.belongsToMany(Activity, {
  through: "ActivityUsers",
  foreignKey: "userId",
  otherKey: "activityId",
  as: "activities",
  onDelete: "CASCADE",
});
Activity.belongsToMany(User, {
  through: "ActivityUsers",
  foreignKey: "activityId",
  otherKey: "userId",
  as: "users",
  onDelete: "CASCADE",
});

GuestUser.belongsToMany(Activity, {
  through: GuestUserActivity,
  foreignKey: "guestUserId",
  otherKey: "activityId",
  as: "activities",
  onDelete: "CASCADE",
});
Activity.belongsToMany(GuestUser, {
  through: GuestUserActivity,
  foreignKey: "activityId",
  otherKey: "guestUserId",
  as: "guestUsers",
  onDelete: "CASCADE",
});

Payment.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
  onDelete: "CASCADE",
});
Payment.belongsTo(Activity, {
  foreignKey: "activityId",
  as: "activity",
  onDelete: "CASCADE",
});
User.hasMany(Payment, {
  foreignKey: "userId",
  as: "payments",
  onDelete: "CASCADE",
});
Activity.hasMany(Payment, {
  foreignKey: "activityId",
  as: "payments",
  onDelete: "CASCADE",
});

ParticipationRequest.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
  onDelete: "CASCADE",
});
ParticipationRequest.belongsTo(Activity, {
  foreignKey: "activityId",
  as: "activity",
  onDelete: "CASCADE",
});
User.hasMany(ParticipationRequest, {
  foreignKey: "userId",
  as: "participationRequests",
  onDelete: "CASCADE",
});
Activity.hasMany(ParticipationRequest, {
  foreignKey: "activityId",
  as: "participationRequests",
  onDelete: "CASCADE",
});
ParticipationRequest.belongsTo(Payment, {
  foreignKey: "paymentId",
  as: "payment",
  onDelete: "SET NULL",
});
Payment.hasOne(ParticipationRequest, {
  foreignKey: "paymentId",
  as: "participationRequest",
  onDelete: "SET NULL",
});

Activity.belongsTo(Chat, {
  foreignKey: "chatId",
  as: "chat",
  onDelete: "SET NULL",
});
Chat.hasOne(Activity, {
  foreignKey: "chatId",
  as: "activity",
  onDelete: "CASCADE",
});

// Group associations
Group.belongsToMany(User, {
  through: GroupMember,
  foreignKey: "group_id",
  otherKey: "user_id",
  as: "members",
  onDelete: "CASCADE",
});
User.belongsToMany(Group, {
  through: GroupMember,
  foreignKey: "user_id",
  otherKey: "group_id",
  as: "groups",
  onDelete: "CASCADE",
});
Group.hasMany(GroupMember, {
  foreignKey: "group_id",
  as: "groupMembers",
  onDelete: "CASCADE",
});
GroupMember.belongsTo(Group, {
  foreignKey: "group_id",
  onDelete: "CASCADE",
});
GroupMember.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
  onDelete: "CASCADE",
});
User.hasMany(GroupMember, {
  foreignKey: "user_id",
  as: "groupMemberships",
  onDelete: "CASCADE",
});

Group.hasMany(GroupMessage, {
  foreignKey: "group_id",
  as: "messages",
  onDelete: "CASCADE",
});
GroupMessage.belongsTo(Group, {
  foreignKey: "group_id",
  onDelete: "CASCADE",
});
GroupMessage.belongsTo(User, {
  foreignKey: "sender_id",
  as: "sender",
  onDelete: "CASCADE",
});
User.hasMany(GroupMessage, {
  foreignKey: "sender_id",
  as: "groupMessages",
  onDelete: "CASCADE",
});
GroupMessage.belongsTo(GroupMessage, {
  foreignKey: "reply_to_id",
  as: "replyTo",
  onDelete: "SET NULL",
});

Group.hasMany(Activity, {
  foreignKey: "groupId",
  as: "activities",
  onDelete: "CASCADE",
});
Activity.belongsTo(Group, {
  foreignKey: "groupId",
  as: "group",
  onDelete: "CASCADE",
});

Chat.belongsToMany(User, {
  through: "ChatUsers",
  foreignKey: "chatId",
  otherKey: "userId",
  as: "members",
  onDelete: "CASCADE",
});
User.belongsToMany(Chat, {
  through: "ChatUsers",
  foreignKey: "userId",
  otherKey: "chatId",
  as: "chats",
  onDelete: "CASCADE",
});

ChatMessage.belongsTo(Chat, {
  foreignKey: "chatId",
  onDelete: "CASCADE",
});
Chat.hasMany(ChatMessage, {
  foreignKey: "chatId",
  onDelete: "CASCADE",
});

ChatMessage.belongsTo(User, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});
User.hasMany(ChatMessage, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});

ChatMessage.hasMany(ChatMessageSeen, {
  foreignKey: "messageId",
  as: "seenByUsers",
  onDelete: "CASCADE",
});
ChatMessageSeen.belongsTo(ChatMessage, {
  foreignKey: "messageId",
  onDelete: "CASCADE",
});
ChatMessageSeen.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
  onDelete: "CASCADE",
});
User.hasMany(ChatMessageSeen, {
  foreignKey: "userId",
  as: "seenMessages",
  onDelete: "CASCADE",
});

const syncNeedsAlter =
  process.env.SYNC_SCHEMA === "production" ||
  process.env.SYNC_SCHEMA === "alter" ||
  process.env.SYNC_SCHEMA === "true";

sequelize.sync(syncNeedsAlter ? { alter: true } : {}).catch((err) => {
  console.error("Sequelize sync error", err);
  process.exit(1);
});

module.exports = {
  sequelize,
  User,
  Organisation,
  Activity,
  GuestUser,
  GuestUserActivity,
  Chat,
  ChatMessage,
  ChatMessageSeen,
  Payment,
  ParticipationRequest,
  Group,
  GroupMember,
  GroupMessage,
};
