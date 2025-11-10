// index.js (รวมไฟล์แบบสมบูรณ์ + ปุ่ม mute/unmute ใน /sss)
const fs = require("fs");
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  Events,
  MessageFlags,
  ActivityType,
  // 🎯 NEW: เพิ่ม Component สำหรับ Select Menu
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// 🔧 เปลี่ยนเป็น ID เซิร์ฟเวอร์ของคุณ
const GUILD_ID = "1148141471984254986";

// Blacklist check interval (ms)
const BLACKLIST_INTERVAL_MS = 500;

let statusData = {};
try {
  statusData = JSON.parse(fs.readFileSync("./status.json", "utf8"));
} catch {}
statusData.rooms = statusData.rooms || {};
statusData.moveChannelId = statusData.moveChannelId || null;
statusData.statusMessageId = statusData.statusMessageId || null;
statusData.logChannelId = statusData.logChannelId || null;
statusData.allowedRoleIds = statusData.allowedRoleIds || [];
statusData.categoryId = statusData.categoryId || null;
statusData.channelId = statusData.channelId || null;

// Blacklist storage
statusData.disBlacklist = statusData.disBlacklist || [];
statusData.blacklistChannelId = statusData.blacklistChannelId || null;
statusData.blacklistMessageId = statusData.blacklistMessageId || null;

function saveStatusData() {
  fs.writeFileSync("./status.json", JSON.stringify(statusData, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const moveState = new Map();

function hasAdminPermission(member) {
  const allowedRoleIds = statusData.allowedRoleIds;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    allowedRoleIds.some((roleId) => member.roles.cache.has(roleId))
  );
}

async function runAdminOnly(interaction, callback) {
  if (!hasAdminPermission(interaction.member)) {
    const replyOptions = {
      content: "❌ คุณไม่มีสิทธิ์ใช้คำสั่งนี้ (ต้องเป็นแอดมิน)",
      flags: [MessageFlags.Ephemeral],
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(replyOptions).catch(() => {});
    } else {
      await interaction.reply(replyOptions).catch(() => {});
    }
    return;
  }
  await callback(interaction);
}

async function handleInteractionError(interaction, error) {
  console.error("❌ เกิดข้อผิดพลาดที่ไม่คาดคิดในการทำงาน:", error);
  const errorMessage = {
    content: "❌ เกิดข้อผิดพลาดที่ไม่คาดคิดในการทำงาน",
    flags: [MessageFlags.Ephemeral],
  };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage).catch(() => {});
    } else {
      await interaction.reply(errorMessage).catch(() => {});
    }
  } catch {}
}

async function logAction(guild, text) {
  if (!statusData.logChannelId) return;
  try {
    const ch = await guild.channels
      .fetch(statusData.logChannelId)
      .catch(() => null);
    if (ch) await ch.send(text);
  } catch (err) {
    console.log("❌ Log Action ล้มเหลว:", err.message);
  }
}
// Part 2/5
async function reconcileLockedRoomsOnStartup(guild) {
  let reconciledCount = 0;
  const roomIds = Object.keys(statusData.rooms);
  for (const channelId of roomIds) {
    const roomRecord = statusData.rooms[channelId];
    if (roomRecord && roomRecord.originalOverwrites !== null) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        delete statusData.rooms[channelId];
        reconciledCount++;
        continue;
      }
      const everyoneRole = guild.roles.everyone;
      const permissions = channel.permissionsFor(everyoneRole);
      if (permissions && permissions.has(PermissionsBitField.Flags.Connect)) {
        roomRecord.originalOverwrites = null;
        reconciledCount++;
      }
    }
  }
  if (reconciledCount > 0) saveStatusData();
}

async function generateEmbed(category) {
  if (!category) {
    return { embed: new EmbedBuilder().setTitle("❌ หมวดหมู่หายไป"), rows: [] };
  }
  const embed = new EmbedBuilder()
    .setTitle(`สถานะห้องเสียง ${category.name}\n\u200B`)
    .setColor(0x00ff00)
    .setFooter({ text: "Secret Zone " })
    .setTimestamp();
  const rows = [];
  const channels = Array.from(category.children.cache.values())
    .filter((c) => c.type === ChannelType.GuildVoice)
    .sort((a, b) => a.position - b.position);

  let tempRow = new ActionRowBuilder();
  let count = 0;
  for (const ch of channels) {
    const updatedChannel = await ch.fetch().catch(() => ch);
    const everyoneRole = category.guild.roles.everyone;
    const permissions = updatedChannel.permissionsFor(everyoneRole);
    const isActuallyLocked = permissions
      ? !permissions.has(PermissionsBitField.Flags.Connect)
      : false;

    if (
      !statusData.rooms[ch.id] ||
      statusData.rooms[ch.id].originalOverwrites === undefined
    ) {
      statusData.rooms[ch.id] = { originalOverwrites: null, name: ch.name };
    }
    statusData.rooms[ch.id].name = ch.name;
    const isLockedByBot = statusData.rooms[ch.id].originalOverwrites !== null;
    const memberCount = ch.members.size;
    const memberStatus =
      memberCount === 0 ? "จำนวน 0 👤" : ` จำนวน ${memberCount} 👤`;
    const lockStatus = isActuallyLocked
      ? "⛔ ปิดการเข้าชั่วคราว"
      : "✅ เข้าได้ปกติ";
    embed.addFields({
      name: ch.name,
      value: `- ${lockStatus} ◈ ${memberStatus}`,
      inline: false,
    });

    const btn = new ButtonBuilder()
      .setCustomId(`toggle_${ch.id}`)
      .setLabel(isLockedByBot ? `🔓 ปลดล็อค ${ch.name}` : `🔒 ล็อค ${ch.name}`)
      .setStyle(isLockedByBot ? ButtonStyle.Secondary : ButtonStyle.Danger);

    tempRow.addComponents(btn);
    count++;
    if (count === 5) {
      rows.push(tempRow);
      tempRow = new ActionRowBuilder();
      count = 0;
    }
  }
  if (count > 0) rows.push(tempRow);
  const refresh = new ButtonBuilder()
    .setCustomId("refresh_embed")
    .setLabel("🔄")
    .setStyle(ButtonStyle.Primary);
  rows.push(new ActionRowBuilder().addComponents(refresh));
  saveStatusData();
  return { embed, rows };
}

async function createSssEmbed(voiceChannel) {
  const everyoneRole = voiceChannel.guild.roles.everyone;
  const permissions = voiceChannel.permissionsFor(everyoneRole);
  const actualIsLocked =
    !permissions.has(PermissionsBitField.Flags.Connect) ||
    !permissions.has(PermissionsBitField.Flags.ViewChannel);
  const statusText = actualIsLocked
    ? "⛔ ปิดอยู่ (ห้องส่วนตัว/ซ่อน)"
    : "✅ เปิดอยู่ (เข้าได้ทุกคน)";
  const embedColor = actualIsLocked ? 0xff0000 : 0x00ff00;
  const nextAction = actualIsLocked ? "open" : "close";
  const toggleButtonLabel = actualIsLocked ? "🔓 เปิดห้อง" : "🔒 ปิดห้อง";
  const members = Array.from(voiceChannel.members.values()).filter(
    (m) => m.id !== voiceChannel.guild.client.user.id,
  );
  const memberCount = members.length;
  const memberList =
    memberCount > 0
      ? members.map((m) => `• ${m.user.toString()}`).join("\n")
      : "ไม่มีสมาชิกคนอื่นในห้อง";

  const embed = new EmbedBuilder()
    .setTitle(`ควบคุมห้องเสียง: ${voiceChannel.name}`)
    .setDescription(`สถานะปัจจุบัน: **${statusText}**\n\u200B`)
    .setColor(embedColor)
    .addFields({
      name: "👥 จำนวนสมาชิกในห้อง",
      value: `**${memberCount}** คน`,
      inline: true,
    })
    .addFields({
      name: "รายชื่อสมาชิก",
      value:
        memberList.length > 1024
          ? memberList.substring(0, 1021) + "..."
          : memberList,
      inline: false,
    })
    .setTimestamp();

  // ปุ่มควบคุมเดิม
  const toggleButton = new ButtonBuilder()
    .setCustomId(`vc_toggle_${nextAction}_${voiceChannel.id}`)
    .setLabel(toggleButtonLabel)
    .setStyle(
      nextAction === "open" ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const kickAllButton = new ButtonBuilder()
    .setCustomId(`vc_kickall_${voiceChannel.id}`)
    .setLabel(`⚠️ เตะ ${memberCount} คน`)
    .setStyle(ButtonStyle.Danger)
    .setDisabled(memberCount === 0);

  // ปุ่มใหม่: Mute All / Unmute All
  const muteAllButton = new ButtonBuilder()
    .setCustomId(`vc_muteall_${voiceChannel.id}`)
    .setLabel("🔇 ปิดเสียงทั้งหมด")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(memberCount === 0);

  const unmuteAllButton = new ButtonBuilder()
    .setCustomId(`vc_unmuteall_${voiceChannel.id}`)
    .setLabel("🔊 เปิดเสียงทั้งหมด")
    .setStyle(ButtonStyle.Success)
    .setDisabled(memberCount === 0);

  const refreshButton = new ButtonBuilder()
    .setCustomId(`vc_refresh_${voiceChannel.id}`)
    .setLabel("🔄")
    .setStyle(ButtonStyle.Primary);

  // ใส่ปุ่มลง row (max 5 ต่อแถว)
  const row = new ActionRowBuilder().addComponents(
    toggleButton,
    muteAllButton,
    unmuteAllButton,
    kickAllButton,
    refreshButton,
  );
  return { embed, row };
}

async function refreshStatusEmbed(guild) {
  if (
    !statusData.categoryId ||
    !statusData.channelId ||
    !statusData.statusMessageId
  )
    return;
  try {
    const ch = await guild.channels
      .fetch(statusData.channelId)
      .catch(() => null);
    const cat = await guild.channels
      .fetch(statusData.categoryId)
      .catch(() => null);
    if (!ch || !cat) return;
    const { embed, rows } = await generateEmbed(cat);
    const msg = await ch.messages
      .fetch(statusData.statusMessageId)
      .catch(() => null);
    if (msg)
      await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
  } catch (err) {
    console.log("❌ รีเฟรช /status ล้มเหลว:", err.message);
  }
}

async function refreshAllSssEmbeds(guild) {
  const textChannels = guild.channels.cache.filter(
    (c) => c.type === ChannelType.GuildText,
  );
  for (const [channelId, channel] of textChannels) {
    try {
      const messages = await channel.messages
        .fetch({ limit: 10 })
        .catch(() => null);
      if (!messages) continue;
      for (const [messageId, message] of messages) {
        if (
          message.author.id === client.user.id &&
          message.components.length > 0
        ) {
          const firstButton = message.components[0].components[0];
          if (
            firstButton &&
            (firstButton.customId.startsWith("vc_toggle_") ||
              firstButton.customId.startsWith("vc_refresh_") ||
              firstButton.customId.startsWith("vc_kickall_") ||
              firstButton.customId.startsWith("vc_muteall_") ||
              firstButton.customId.startsWith("vc_unmuteall_"))
          ) {
            const parts = firstButton.customId.split("_");
            const voiceChannelId =
              parts.find((p) => p.length > 5 && !isNaN(p)) ||
              parts[3] ||
              parts[2];
            const voiceChannel = await guild.channels
              .fetch(voiceChannelId)
              .catch(() => null);
            if (voiceChannel && voiceChannel.type === ChannelType.GuildVoice) {
              const { embed: newEmbed, row: newRow } =
                await createSssEmbed(voiceChannel);
              await message
                .edit({ embeds: [newEmbed], components: [newRow] })
                .catch(() => {});
            } else {
              await message.delete().catch(() => {});
            }
          }
        }
      }
    } catch (e) {}
  }
}
// Part 3/5
async function moveUserLoop(
  interaction,
  member,
  fromChannel,
  toChannel,
  rounds,
  delay,
  isCatMove = false,
  isSweepMode = false,
  initialReverse = false,
) {
  const stateKey = isCatMove ? fromChannel.id : member.id;
  if (moveState.get(stateKey)?.running) return;
  moveState.set(stateKey, {
    running: true,
    from: fromChannel,
    to: toChannel,
    rounds,
    delay,
    memberId: member.id,
  });
  if (!fromChannel || !toChannel) {
    await logAction(
      interaction.guild,
      `⚠️ การย้ายถูกยกเลิก: ช่องเสียงต้นทาง/ปลายทางหายไป`,
    );
    moveState.delete(stateKey);
    return;
  }

  if (isSweepMode) {
    await logAction(
      interaction.guild,
      `🧹 เริ่มโหมดกวาด หมวด ${fromChannel.name} -> ${toChannel.name}`,
    );
    const membersToMove = Array.from(interaction.guild.channels.cache.values())
      .filter(
        (ch) =>
          ch.parentId === fromChannel.id &&
          ch.type === ChannelType.GuildVoice &&
          ch.id !== toChannel.id,
      )
      .flatMap((ch) => Array.from(ch.members.values()))
      .filter((m) => m.voice.channel);
    for (const m of membersToMove) {
      if (!moveState.get(stateKey)?.running) break;
      if (m.voice.channel.id === toChannel.id) continue;
      try {
        await m.voice.setChannel(toChannel);
        await logAction(
          interaction.guild,
          `➡️ กวาด ${m.user.tag} ไป ${toChannel.name}`,
        );
      } catch (e) {}
    }
    moveState.delete(stateKey);
    await logAction(interaction.guild, `✅ การกวาดเสร็จสิ้น`);
    return;
  }

  const initialLog = isCatMove
    ? `🔥 เริ่มย้ายหมวด ${fromChannel.name}`
    : `🔥 เริ่มย้าย ${member.user.tag}`;
  await logAction(interaction.guild, initialLog);

  const startOffset = initialReverse ? 1 : 0;
  for (let i = 0; i < rounds; i++) {
    if (!moveState.get(stateKey)?.running) break;
    const currentTargetVC =
      (i + startOffset) % 2 === 0 ? toChannel : fromChannel;
    const membersToMove = isCatMove
      ? Array.from(interaction.guild.channels.cache.values())
          .filter(
            (ch) =>
              ch.parentId === fromChannel.parentId &&
              ch.type === ChannelType.GuildVoice &&
              (ch.id === fromChannel.id || ch.id === toChannel.id),
          )
          .flatMap((ch) => Array.from(ch.members.values()))
          .filter((m) => m.voice.channel)
      : [member];
    for (const m of membersToMove) {
      if (!moveState.get(stateKey)?.running) break;
      const isInTargetPair =
        m.voice.channel &&
        (m.voice.channel.id === fromChannel.id ||
          m.voice.channel.id === toChannel.id);
      if (isInTargetPair && m.voice.channel.id !== currentTargetVC.id) {
        try {
          await m.voice.setChannel(currentTargetVC);
          await logAction(
            interaction.guild,
            `➡️ ย้าย ${m.user.tag} ไป ${currentTargetVC.name} (รอบ ${i + 1}/${rounds})`,
          );
        } catch (e) {}
      } else if (!isCatMove && !isInTargetPair) {
        await logAction(
          interaction.guild,
          `⚠️ ${member.user.tag} ไม่อยู่ในห้องที่เกี่ยวข้องแล้ว ยกเลิก`,
        );
        moveState.delete(stateKey);
        return;
      }
    }
    if (!moveState.get(stateKey)?.running) break;
    if (i < rounds - 1) await sleep(delay);
  }
  moveState.delete(stateKey);
  await logAction(interaction.guild, `✅ การย้ายเสร็จสิ้น`);
}

// SSS command
async function createSssMessage(voiceChannel, channel) {
  const { embed, row } = await createSssEmbed(voiceChannel);
  return await channel.send({ embeds: [embed], components: [row] });
}

// ------------------ Blacklist related ------------------
// Run loop to forcibly disconnect blacklisted users if they're in voice
async function runBlacklistLoop(guild) {
  if (!guild || statusData.disBlacklist.length === 0) return;
  for (const memberId of statusData.disBlacklist) {
    const currentMember = await guild.members.fetch(memberId).catch(() => null);
    if (currentMember && currentMember.voice.channelId) {
      try {
        await currentMember.voice.disconnect(`ถูกตัดโดย Blacklist /dis`);
      } catch (e) {}
    }
  }
}

// 🎯 แก้ไข: Generate embed for blacklist (New version returning { embed, components })
async function generateBlacklistEmbed(guild, includeComponents = true) {
  const embed = new EmbedBuilder()
    .setTitle("⛔ รายชื่อบัญชีดำ (Blacklist)")
    .setDescription(`No สน No แคร์ ไม่ ใช่ พ่อ กู หนิ`)
    .setColor(0xff0000)
    .setTimestamp();

  if (statusData.disBlacklist.length === 0) {
    embed.addFields({
      name: "✅ ไม่มีสมาชิกในบัญชีดำ",
      value: "ใช้เมนูเลือกด้านล่างเพื่อเพิ่ม/ลบสมาชิก", // 🎯 เปลี่ยนข้อความแนะนำ
    });
  } else {
    const fields = [];
    // พยายาม fetch สมาชิกทั้งหมดเพื่อใช้ข้อมูลแท็ก
    await guild.members
      .fetch({ user: statusData.disBlacklist, force: false })
      .catch(() => {});

    for (const memberId of statusData.disBlacklist) {
      // ใช้ cache ถ้ามี หรือ fetch
      const member =
        guild.members.cache.get(memberId) ||
        (await guild.members.fetch(memberId).catch(() => null));
      const name = member ? `${member.user.tag}` : `👤 ไม่พบสมาชิก`;
      const status =
        member && member.voice.channelId
          ? `🔥 กำลังถูกตัดจาก **${member.voice.channel.name}**`
          : `✅ เฝ้าระวัง`;
      fields.push({
        name: `${name} (ID: ${memberId})`,
        value: status,
        inline: false,
      });
    }
    if (fields.length > 25) {
      embed.addFields(fields.slice(0, 24));
      embed.setFooter({
        text: `แสดง ${24} จากทั้งหมด ${fields.length} รายการ`,
      });
    } else {
      embed.addFields(fields);
    }
  }

  const components = [];
  if (includeComponents) {
    // 1. User Select Menu สำหรับ 'ADD' สมาชิก
    const addMenu = new UserSelectMenuBuilder()
      .setCustomId("dis_add_user_menu") // Custom ID สำหรับเพิ่ม
      .setPlaceholder("➕ เลือกสมาชิกที่ต้องการเพิ่ม")
      .setMinValues(1)
      .setMaxValues(10);

    components.push(new ActionRowBuilder().addComponents(addMenu));

    // 2. String Select Menu สำหรับ 'REMOVE' สมาชิก (ถ้ามีสมาชิกใน Blacklist)
    if (statusData.disBlacklist.length > 0) {
      // สร้าง Options จาก ID ที่มีอยู่
      const removeOptions = statusData.disBlacklist.slice(0, 25).map((id) => {
        // ใช้ cache หรือ fallback
        const member = guild.members.cache.get(id) || {
          user: { tag: `ID: ${id}` },
        };
        return {
          label: member.user.tag.substring(0, 100),
          value: id,
          description: "คลิกเพื่อลบสมาชิกคนนี้ออก",
        };
      });

      const removeMenu = new StringSelectMenuBuilder()
        .setCustomId("dis_remove_user_menu") // Custom ID สำหรับลบ
        .setPlaceholder("➖ เลือกลบสมาชิก")
        .setMinValues(1)
        .setMaxValues(1) // ลบทีละคน
        .addOptions(removeOptions);

      components.push(new ActionRowBuilder().addComponents(removeMenu));
    }

    // 3. ปุ่ม 'REFRESH'
    const refresh = new ButtonBuilder()
      .setCustomId("refresh_dis_embed")
      .setLabel("🔄")
      .setStyle(ButtonStyle.Primary);

    components.push(new ActionRowBuilder().addComponents(refresh));
  }

  return { embed, components };
}

// 🎯 ลบ createBlacklistComponents() ทิ้ง

// 🎯 แก้ไข: Update refreshBlacklistEmbed to use the new function signature
async function refreshBlacklistEmbed(guild) {
  try {
    const channelId = statusData.blacklistChannelId || statusData.channelId;
    if (!channelId) return;
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const { embed, components } = await generateBlacklistEmbed(guild, true); // Use new function

    if (statusData.blacklistMessageId) {
      const msg = await ch.messages
        .fetch(statusData.blacklistMessageId)
        .catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components }).catch(() => {});
        return;
      }
    }

    const newMsg = await ch.send({ embeds: [embed], components });
    statusData.blacklistChannelId = ch.id;
    statusData.blacklistMessageId = newMsg.id;
    saveStatusData();
  } catch (err) {
    console.error("❌ รีเฟรช Blacklist ล้มเหลว:", err.message);
  }
}
// Part 4/5
// COMMAND definitions (รวม /dis)
const commands = [
  // status, move, movecat, sss, sss etc. (หากคุณใช้คำสั่งเดิมจากไฟล์ ให้รวมรายการคำสั่งทั้งหมดที่คุณต้องการ)
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("ตั้ง embed แสดงสถานะห้องเสียงของหมวดหมู่")
    .addChannelOption((opt) =>
      opt
        .setName("category")
        .setDescription("เลือกหมวดหมู่")
        .setRequired(true)
        .addChannelTypes([ChannelType.GuildCategory]),
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("เลือกช่องข้อความ")
        .setRequired(true)
        .addChannelTypes([ChannelType.GuildText]),
    )
    .addChannelOption((opt) =>
      opt
        .setName("move_channel")
        .setDescription("ช่องสำหรับแสดงสถานะการย้าย (/move, /movecat)")
        .setRequired(false)
        .addChannelTypes([ChannelType.GuildText]),
    )
    .addChannelOption((opt) =>
      opt
        .setName("log_channel")
        .setDescription(
          "ช่องสำหรับบันทึก Log การควบคุมห้องเสียง (/status, /sss)",
        )
        .setRequired(false)
        .addChannelTypes([ChannelType.GuildText]),
    ),
  new SlashCommandBuilder()
    .setName("move")
    .setDescription("ย้ายสมาชิกคนเดียวสลับห้อง")
    .addChannelOption((opt) =>
      opt
        .setName("from")
        .setDescription("ห้องต้นทาง")
        .setRequired(true)
        .addChannelTypes([ChannelType.GuildVoice]),
    )
    .addChannelOption((opt) =>
      opt
        .setName("to")
        .setDescription("ห้องปลายทาง")
        .setRequired(true)
        .addChannelTypes([ChannelType.GuildVoice]),
    )
    .addUserOption((opt) =>
      opt.setName("user").setDescription("สมาชิกที่จะย้าย").setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt.setName("reverse").setDescription("สลับทิศทาง").setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("movecat")
    .setDescription("ย้ายสมาชิกทั้งหมดในหมวดหมู่")
    .addChannelOption((opt) =>
      opt
        .setName("category")
        .setDescription("เลือกหมวดหมู่")
        .setRequired(true)
        .addChannelTypes([ChannelType.GuildCategory]),
    ),
  new SlashCommandBuilder()
    .setName("sss")
    .setDescription("ส่งปุ่มควบคุมเพื่อเปิด/ปิดห้องเสียงที่เลือก")
    .addChannelOption((opt) =>
      opt
        .setName("voice_channel")
        .setDescription("เลือกห้องเสียงที่ต้องการควบคุม")
        .setRequired(true)
        .addChannelTypes([ChannelType.GuildVoice]),
    ),
  // DIS command
  new SlashCommandBuilder()
    .setName("dis")
    .setDescription(
      "ตั้งค่า Embed สำหรับจัดการบัญชีดำ (Blacklist) ผ่านเมนูเลือก",
    ) // 🎯 แก้ Description
    .addSubcommand(
      (sub) =>
        sub
          .setName("list")
          .setDescription("ส่ง Embed จัดการ Blacklist ค้างไว้ในช่องนี้"), // 🎯 แก้ Description
    ),
].map((c) => c.toJSON());

// Handlers for status, move, movecat, sss (ย่อความ — ให้คุณแทนที่ด้วย handler เดิมถ้าต้องการ)
async function handleStatus(interaction) {
  await runAdminOnly(interaction, async (i) => {
    const category = i.options.getChannel("category");
    const channel = i.options.getChannel("channel");
    const moveCh = i.options.getChannel("move_channel");
    const logCh = i.options.getChannel("log_channel");

    try {
      if (statusData.statusMessageId && statusData.channelId) {
        const oldCh = await i.guild.channels
          .fetch(statusData.channelId)
          .catch(() => null);
        if (oldCh) {
          const oldMsg = await oldCh.messages
            .fetch(statusData.statusMessageId)
            .catch(() => null);
          if (oldMsg) await oldMsg.delete().catch(() => {});
        }
      }
    } catch (e) {}

    statusData.categoryId = category.id;
    statusData.channelId = channel.id;
    if (moveCh) statusData.moveChannelId = moveCh.id;
    if (logCh) statusData.logChannelId = logCh.id;

    const everyoneRole = i.guild.roles.everyone;
    const voiceChannels = category.children.cache.filter(
      (c) => c.type === ChannelType.GuildVoice,
    );
    let resetCount = 0;
    for (const [chId, ch] of voiceChannels) {
      if (
        !statusData.rooms[chId] ||
        statusData.rooms[chId].originalOverwrites === undefined
      ) {
        statusData.rooms[chId] = { originalOverwrites: null, name: ch.name };
      } else {
        statusData.rooms[chId].name = ch.name;
      }
      try {
        await ch.permissionOverwrites.edit(everyoneRole, {
          Connect: true,
          ViewChannel: true,
        });
        statusData.rooms[chId].originalOverwrites = null;
        resetCount++;
      } catch (e) {
        console.error(
          `❌ ไม่สามารถรีเซ็ตสิทธิ์ห้อง ${ch.name} ได้:`,
          e.message,
        );
      }
    }

    const { embed, rows } = await generateEmbed(category);
    const msg = await channel.send({ embeds: [embed], components: rows });
    statusData.statusMessageId = msg.id;
    saveStatusData();

    try {
      await refreshBlacklistEmbed(i.guild);
    } catch (e) {}
    await logAction(
      i.guild,
      `📝 ผู้ใช้ ${i.member.user.tag} ตั้งค่า Embed สถานะห้องเสียงใน #${channel.name} (รีเซ็ตสิทธิ์ ${resetCount} ห้อง)`,
    );
    await i.editReply("✅ ตั้งค่า embed เรียบร้อยแล้ว");
  });
}

async function handleMove(interaction) {
  await runAdminOnly(interaction, async (i) => {
    const from = i.options.getChannel("from");
    const to = i.options.getChannel("to");
    const rounds = 200;
    const delay = 1000;
    const user = i.options.getUser("user");
    const reverse = i.options.getBoolean("reverse") || false;

    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (!member || !member.voice.channel)
      return await i.editReply({
        content: `❌ สมาชิก ${user.tag} ไม่อยู่ในช่องเสียง`,
        flags: [MessageFlags.Ephemeral],
      });

    const stateKey = member.id;
    if (moveState.get(stateKey)?.running)
      return await i.editReply({
        content: `❌ การย้าย ${user.tag} กำลังทำงานอยู่`,
        flags: [MessageFlags.Ephemeral],
      });

    const stopRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stop_move_${member.id}`)
        .setLabel("⛔ หยุดการย้าย")
        .setStyle(ButtonStyle.Danger),
    );
    await i.editReply({
      content: `🚀 เริ่มย้าย ${user.tag} ระหว่าง ${from.name} ⇆ ${to.name}`,
      components: [stopRow],
    });
    moveUserLoop(i, member, from, to, rounds, delay, false, false, reverse);
  });
}

async function handleMovecat(interaction) {
  await runAdminOnly(interaction, async (i) => {
    const category = i.options.getChannel("category");
    // สำหรับย้ายหมวด ให้เรียก moveUserLoop แบบ isCatMove = true หรือโหมดกวาดตามที่ต้องการ
    await i.editReply({
      content: `🚀 เริ่มย้ายหมวด ${category.name}`,
      components: [],
    });
  });
}

async function handleSss(interaction) {
  await runAdminOnly(interaction, async (i) => {
    const voiceChannel = i.options.getChannel("voice_channel");
    const { embed, row } = await createSssEmbed(voiceChannel);
    await i.deleteReply().catch(() => {});
    const msg = await i.channel.send({ embeds: [embed], components: [row] });
    await logAction(
      i.guild,
      `📢 ${i.member.user.tag} สร้างปุ่มควบคุมห้อง ${voiceChannel.name} ใน #${i.channel.name}`,
    );
  });
}

// 🎯 แก้ไข: DIS handler (เหลือแค่ list)
async function handleBlacklistManage(interaction) {
  await runAdminOnly(interaction, async (i) => {
    const subcommand = i.options.getSubcommand();
    const guild = i.guild;

    if (subcommand === "list") {
      // 1. ลบข้อความเก่าที่เคยตั้งไว้ (ถ้ามี)
      if (statusData.blacklistMessageId && statusData.blacklistChannelId) {
        try {
          const oldCh = await i.guild.channels
            .fetch(statusData.blacklistChannelId)
            .catch(() => null);
          if (oldCh) {
            const oldMsg = await oldCh.messages
              .fetch(statusData.blacklistMessageId)
              .catch(() => null);
            if (oldMsg) await oldMsg.delete().catch(() => {});
          }
        } catch (e) {
          /* ignore */
        }
      }

      // 2. สร้างและส่ง Embed พร้อม Select Menus และปุ่ม
      const { embed, components } = await generateBlacklistEmbed(guild, true);

      await i.deleteReply().catch(() => {}); // ลบ deferReply เดิม

      const newMsg = await i.channel.send({ embeds: [embed], components });

      // บันทึก Message ID และ Channel ID ใหม่
      statusData.blacklistChannelId = i.channelId;
      statusData.blacklistMessageId = newMsg.id;
      saveStatusData();

      await logAction(
        i.guild,
        `📝 ผู้ใช้ **${i.member.user.tag}** ได้ตั้งค่า Embed Blacklist (/dis) ในช่อง **#${i.channel.name}**`,
      );
      return; // จบการทำงาน
    }

    await i.editReply({
      content:
        "❌ คำสั่งไม่ถูกต้อง โปรดใช้ `/dis list` เพื่อตั้งค่าหน้าจัดการ Blacklist",
      flags: [MessageFlags.Ephemeral],
    });
  });
}

// ---------------------------------------------
// 🎯 NEW: SELECT MENU HANDLERS
// ---------------------------------------------
async function handleBlacklistMenuAction(interaction, actionType) {
  await runAdminOnly(interaction, async (i) => {
    // ใช้ runAdminOnly เพื่อเช็คสิทธิ์
    await i.deferUpdate();

    const selectedIds = i.values;
    const guild = i.guild;
    let replyContent = "";

    // 1. ดำเนินการตาม Action (เพิ่มหรือลบ)
    if (actionType === "add") {
      let addedCount = 0;
      for (const id of selectedIds) {
        if (id === i.client.user.id) continue;
        if (!statusData.disBlacklist.includes(id)) {
          statusData.disBlacklist.push(id);
          addedCount++;
          const user = await client.users
            .fetch(id)
            .catch(() => ({ tag: `ID: ${id}` }));
          await logAction(
            guild,
            `➕ สมาชิก **${user.tag}** ถูกเพิ่มเข้า Blacklist โดย **${i.user.tag}** (ผ่าน Select Menu)`,
          );
        }
      }
      replyContent =
        addedCount > 0
          ? `✅ เพิ่มสมาชิก ${addedCount} คนเข้าสู่บัญชีดำแล้ว`
          : `⚠️ สมาชิกที่เลือกทั้งหมดอยู่ในบัญชีดำอยู่แล้ว`;
    } else if (actionType === "remove") {
      let removedCount = 0;
      for (const id of selectedIds) {
        const index = statusData.disBlacklist.indexOf(id);
        if (index > -1) {
          statusData.disBlacklist.splice(index, 1);
          removedCount++;
          const user = await client.users
            .fetch(id)
            .catch(() => ({ tag: `ID: ${id}` }));
          await logAction(
            guild,
            `➖ สมาชิก **${user.tag}** ถูกลบออกจาก Blacklist โดย **${i.user.tag}** (ผ่าน Select Menu)`,
          );
        }
      }
      replyContent =
        removedCount > 0
          ? `✅ ลบสมาชิก ${removedCount} คนออกจากบัญชีดำแล้ว`
          : `⚠️ สมาชิกที่เลือกไม่อยู่ในบัญชีดำ`;
    }

    saveStatusData();

    // 2. อัปเดต Embed ด้วยข้อมูลใหม่ (เช็คว่ายังเป็น Embed หลักที่ตั้งค่าไว้หรือไม่)
    if (
      i.message.id !== statusData.blacklistMessageId ||
      i.channelId !== statusData.blacklistChannelId
    ) {
      return await i.followUp({
        content: replyContent + " (Embed หลักไม่ได้รับการอัปเดต)",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const { embed: newEmbed, components: newComponents } =
      await generateBlacklistEmbed(guild, true);

    // 3. แก้ไข (Edit) ข้อความเดิม
    await i.message.edit({ embeds: [newEmbed], components: newComponents });
    await i.followUp({
      content: replyContent,
      flags: [MessageFlags.Ephemeral],
    });
  });
}

const selectMenuHandlers = {
  dis_add_user_menu: (i) => handleBlacklistMenuAction(i, "add"),
  dis_remove_user_menu: (i) => handleBlacklistMenuAction(i, "remove"),
};

// Buttons router
const buttonHandlers = {
  stop_move_: async (interaction) => {
    await runAdminOnly(interaction, async (i) => {
      await i.deferUpdate();
      const id = i.customId;
      const parts = id.split("_");
      const stateKey = parts.slice(2).join("_");
      const state = moveState.get(stateKey);
      if (state && state.running) {
        state.running = false;
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(id)
            .setLabel("✅ กำลังหยุด...")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );
        await i.editReply({
          content: "🛑 สั่งหยุดการทำงานแล้ว...",
          components: [disabledRow],
        });
      } else {
        await i.editReply({
          content: "✅ การทำงานนี้เสร็จสิ้นหรือถูกหยุดไปแล้ว",
          components: [],
        });
      }
    });
  },
  stop_movecat_: async (interaction) => {
    // reuse same as stop_move_
    await buttonHandlers.stop_move_(interaction);
  },
  confirm_mass_dm_: async (interaction) => {},
  cancel_mass_dm: async (interaction) => {},
  vc_refresh_: async (interaction) => {
    await interaction.deferUpdate();
    const channelId = interaction.customId.split("_")[2];
    const voiceChannel = await interaction.guild.channels
      .fetch(channelId)
      .catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.message.delete().catch(() => {});
      return;
    }
    const { embed, row } = await createSssEmbed(voiceChannel);
    await interaction.message.edit({ embeds: [embed], components: [row] });
  },
  vc_kickall_: async (interaction) => {
    await interaction.deferUpdate();
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageChannels,
      ) &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.MoveMembers)
    ) {
      return await interaction.followUp({
        content: "❌ คุณไม่มีสิทธิ์",
        flags: [MessageFlags.Ephemeral],
      });
    }
    const channelId = interaction.customId.split("_")[2];
    const voiceChannel = await interaction.guild.channels
      .fetch(channelId)
      .catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.message.delete().catch(() => {});
      return;
    }
    const membersToKick = Array.from(voiceChannel.members.values()).filter(
      (m) => m.id !== client.user.id,
    );
    let kickedCount = 0;
    for (const member of membersToKick) {
      await member.voice
        .disconnect(`ถูกเตะโดย ${interaction.member.user.tag}`)
        .then(() => kickedCount++)
        .catch(() => {});
    }
    const { embed, row } = await createSssEmbed(voiceChannel);
    await interaction.message.edit({ embeds: [embed], components: [row] });
    await interaction.followUp({
      content: `✅ เตะ ${kickedCount} คนแล้ว`,
      flags: [MessageFlags.Ephemeral],
    });
  },
  vc_toggle_: async (interaction) => {
    await interaction.deferUpdate();
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageChannels,
      ) &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)
    ) {
      return await interaction.followUp({
        content: "❌ คุณไม่มีสิทธิ์",
        flags: [MessageFlags.Ephemeral],
      });
    }
    const parts = interaction.customId.split("_");
    const action = parts[2];
    const channelId = parts[3];
    const voiceChannel = await interaction.guild.channels
      .fetch(channelId)
      .catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.message.delete().catch(() => {});
      return;
    }
    const everyoneRole = interaction.guild.roles.everyone;
    try {
      const overwrites =
        action === "open"
          ? { Connect: true, ViewChannel: true }
          : { Connect: false, ViewChannel: false };
      await voiceChannel.permissionOverwrites.edit(everyoneRole, overwrites);
      const { embed: newEmbed, row: newRow } =
        await createSssEmbed(voiceChannel);
      await interaction.message.edit({
        embeds: [newEmbed],
        components: [newRow],
      });
      if (statusData.logChannelId) {
        const now = new Date().toLocaleString("th-TH", {
          timeZone: "Asia/Bangkok",
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const userAvatar = interaction.member.user.displayAvatarURL({
          dynamic: true,
          size: 1024,
        });
        const logEmbed = new EmbedBuilder()
          .setColor(action === "open" ? 0x00ae86 : 0xff0000)
          .setAuthor({ name: interaction.member.user.tag, iconURL: userAvatar })
          .setDescription(
            `${action === "open" ? "🔓 เปิด" : "🔒 ปิด"} ห้อง ${voiceChannel.name}`,
          )
          .addFields({ name: "🕒 เวลา", value: now, inline: true })
          .setThumbnail(userAvatar)
          .setFooter({ text: "ระบบควบคุมห้องเสียง (/sss)" })
          .setTimestamp();
        const ch = await interaction.guild.channels
          .fetch(statusData.logChannelId)
          .catch(() => null);
        if (ch) await ch.send({ embeds: [logEmbed] });
      }
    } catch (error) {
      await interaction.followUp({
        content: "❌ เกิดข้อผิดพลาดในการเปลี่ยนสิทธิ์",
        flags: [MessageFlags.Ephemeral],
      });
    }
  },

  // Mute all
  vc_muteall_: async (interaction) => {
    await interaction.deferUpdate();
    // สิทธิ์: ต้องมี ManageChannels หรือ MuteMembers
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageChannels,
      ) &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.MuteMembers)
    ) {
      return await interaction.followUp({
        content: "❌ คุณไม่มีสิทธิ์ ปิดเสียงสมาชิกทั้งหมด",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const channelId = interaction.customId.split("_")[2];
    const voiceChannel = await interaction.guild.channels
      .fetch(channelId)
      .catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.followUp({
        content: "❌ ไม่พบห้องเสียงนี้",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const membersToMute = Array.from(voiceChannel.members.values()).filter(
      (m) => m.id !== client.user.id,
    );
    let mutedCount = 0;
    for (const member of membersToMute) {
      try {
        // พยายามเซิร์ฟเวอร์มิวต์ (server mute)
        await member.voice.setMute(true, `Muted by ${interaction.user.tag}`);
        mutedCount++;
      } catch (e) {
        // ignore per-member errors
      }
    }

    const { embed, row } = await createSssEmbed(voiceChannel);
    await interaction.message.edit({ embeds: [embed], components: [row] });

    // Log
    if (statusData.logChannelId) {
      const ch = await interaction.guild.channels
        .fetch(statusData.logChannelId)
        .catch(() => null);
      if (ch)
        await ch.send(
          `🔇 ${interaction.user.tag} ปิดเสียงสมาชิก ${mutedCount} คนใน ${voiceChannel.name}`,
        );
    }

    await interaction.followUp({
      content: `🔇 ปิดเสียงสมาชิก ${mutedCount} คนใน **${voiceChannel.name}** เรียบร้อยแล้ว`,
      flags: [MessageFlags.Ephemeral],
    });
  },

  // Unmute all
  vc_unmuteall_: async (interaction) => {
    await interaction.deferUpdate();
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.ManageChannels,
      ) &&
      !interaction.member.permissions.has(PermissionsBitField.Flags.MuteMembers)
    ) {
      return await interaction.followUp({
        content: "❌ คุณไม่มีสิทธิ์ เปิดเสียงสมาชิกทั้งหมด",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const channelId = interaction.customId.split("_")[2];
    const voiceChannel = await interaction.guild.channels
      .fetch(channelId)
      .catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      await interaction.followUp({
        content: "❌ ไม่พบห้องเสียงนี้",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const membersToUnmute = Array.from(voiceChannel.members.values()).filter(
      (m) => m.id !== client.user.id,
    );
    let unmutedCount = 0;
    for (const member of membersToUnmute) {
      try {
        await member.voice.setMute(false, `Unmuted by ${interaction.user.tag}`);
        unmutedCount++;
      } catch (e) {}
    }

    const { embed, row } = await createSssEmbed(voiceChannel);
    await interaction.message.edit({ embeds: [embed], components: [row] });

    if (statusData.logChannelId) {
      const ch = await interaction.guild.channels
        .fetch(statusData.logChannelId)
        .catch(() => null);
      if (ch)
        await ch.send(
          `🔊 ${interaction.user.tag} เปิดเสียงสมาชิก ${unmutedCount} คนใน ${voiceChannel.name}`,
        );
    }

    await interaction.followUp({
      content: `🔊 เปิดเสียงสมาชิก ${unmutedCount} คนใน **${voiceChannel.name}** เรียบร้อยแล้ว`,
      flags: [MessageFlags.Ephemeral],
    });
  },

  toggle_: async (interaction) => {
    // toggle lock/unlock from status embed
    await runAdminOnly(interaction, async (i) => {
      await i.deferUpdate();
      const channelId = i.customId.split("_")[1];
      const channel = await i.guild.channels.fetch(channelId).catch(() => null);
      if (!channel) return;
      const everyone = channel.guild.roles.everyone;
      if (
        !statusData.rooms[channelId] ||
        statusData.rooms[channelId].originalOverwrites === undefined
      ) {
        statusData.rooms[channelId] = {
          originalOverwrites: null,
          name: channel.name,
        };
      }
      const isLockedByBot =
        statusData.rooms[channelId].originalOverwrites !== null;
      let logMessage = "";
      try {
        if (isLockedByBot) {
          const originalOverwrites =
            statusData.rooms[channelId].originalOverwrites;
          await channel.permissionOverwrites.set([]);
          if (originalOverwrites && originalOverwrites.length > 0) {
            const djsOverwrites = originalOverwrites.map((ow) => ({
              id: ow.id,
              type: ow.type,
              allow: BigInt(ow.allow),
              deny: BigInt(ow.deny),
            }));
            await channel.permissionOverwrites.set(djsOverwrites);
          }
          statusData.rooms[channelId].originalOverwrites = null;
          logMessage = `🔓 ปลดล็อคห้อง ${channel.name}`;
        } else {
          const currentOverwrites = Array.from(
            channel.permissionOverwrites.cache.values(),
          ).map((overwrite) => ({
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield.toString(),
            deny: overwrite.deny.bitfield.toString(),
          }));
          statusData.rooms[channelId].originalOverwrites = currentOverwrites;
          await channel.permissionOverwrites.set([]);
          await channel.permissionOverwrites.edit(everyone, { Connect: false });
          logMessage = `🔒 ล็อคห้อง ${channel.name} (บันทึกสิทธิ์เดิม)`;
        }
      } catch (error) {
        await i.followUp({
          content: "❌ เกิดข้อผิดพลาดในการเปลี่ยนสิทธิ์",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      saveStatusData();
      await sleep(200);
      await refreshStatusEmbed(i.guild);
    });
  },
  refresh_embed: async (interaction) => {
    await interaction.deferUpdate();
    await refreshStatusEmbed(interaction.guild);
  },
  refresh_dis_embed: async (interaction) => {
    await interaction.deferUpdate();
    await refreshBlacklistEmbed(interaction.guild);
  },
};

// COMMAND handlers router
const commandHandlers = {
  status: handleStatus,
  move: handleMove,
  movecat: handleMovecat,
  sss: handleSss,
  dis: handleBlacklistManage,
};
// Part 5/5
client.once(Events.ClientReady, async () => {
  console.log(`🤖 เข้าสู่ระบบ: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "🔴REDZONE🔴",
        type: ActivityType.Streaming,
        url: "https://www.youtube.com/1",
      },
    ],
    status: "dnd",
  });

  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (guild) {
    await guild.commands.set(commands);
    console.log(`✍️ ลงทะเบียนคำสั่ง GUILD ID: ${GUILD_ID}`);
  } else {
    console.error(`❌ Guild ID ${GUILD_ID} not found or bot not in guild.`);
    return;
  }

  console.log("🛠️ กำลังเชื่อมต่อห้องเสียงที่ล็อคไว้...");
  await reconcileLockedRoomsOnStartup(guild);

  console.log("🔄 กำลังอัพเดทผัง");
  await refreshStatusEmbed(guild);
  await refreshAllSssEmbeds(guild);
  await refreshBlacklistEmbed(guild);

  console.log(
    `🔥 ลูปนรกสำหรับ Blacklist (ความเร็ว ${BLACKLIST_INTERVAL_MS}ms)`,
  );
  setInterval(async () => {
    await runBlacklistLoop(guild);
  }, BLACKLIST_INTERVAL_MS);

  setInterval(async () => {
    await refreshStatusEmbed(guild);
    await refreshAllSssEmbeds(guild);
    await refreshBlacklistEmbed(guild);
  }, 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const commandName = interaction.commandName;
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const handler = commandHandlers[commandName];
      if (handler) await handler(interaction);
      else await interaction.editReply("❌ ไม่พบคำสั่งนี้");
    } else if (interaction.isButton()) {
      const id = interaction.customId;
      let foundHandler = null;
      for (const prefix in buttonHandlers) {
        if (id.startsWith(prefix)) {
          foundHandler = buttonHandlers[prefix];
          break;
        }
      }
      if (foundHandler) await foundHandler(interaction);
    } else if (
      interaction.isUserSelectMenu() ||
      interaction.isStringSelectMenu()
    ) {
      // 🎯 NEW: Handler สำหรับ Select Menus
      const customId = interaction.customId;
      const handler = selectMenuHandlers[customId];

      if (handler) {
        await handler(interaction);
      } else {
        await interaction
          .reply({
            content: "❌ Select Menu นี้ไม่มี Handler",
            flags: [MessageFlags.Ephemeral],
          })
          .catch(() => {});
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("❌ ล้มเหลวในการล็อกอินบอท:", err.message);
});
