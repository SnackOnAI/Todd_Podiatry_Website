require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

function toIcsDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcs(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildFollowUpInvite({ name, telephone, email, contactMethod, preferredContactTime }) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  const timeMap = {
    Morning: { hours: 9, minutes: 30 },
    Midday: { hours: 12, minutes: 30 },
    Afternoon: { hours: 15, minutes: 0 },
    Evening: { hours: 18, minutes: 30 },
    'Any time': { hours: 11, minutes: 0 },
  };

  const match = timeMap[preferredContactTime] || timeMap['Any time'];
  const candidateStart = new Date(now);
  candidateStart.setHours(match.hours, match.minutes, 0, 0);

  if (now >= candidateStart) {
    start.setDate(now.getDate() + 1);
  } else {
    start.setDate(now.getDate());
  }

  start.setHours(match.hours, match.minutes, 0, 0);
  end.setTime(start.getTime() + 30 * 60 * 1000);

  const preferredTime = preferredContactTime || 'No preference';
  const description = [
    'Follow-up reminder for a new patient enquiry from Todd Podiatry.',
    `Name: ${name}`,
    `Telephone: ${telephone}`,
    `Email: ${email}`,
    `Preferred contact method: ${contactMethod}`,
    `Preferred contact time: ${preferredTime}`,
    '',
    'Please contact the patient as soon as possible.',
  ].join('\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Todd Podiatry//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${Date.now()}-${name.replace(/\s+/g, '-').toLowerCase()}@toddpodiatry.co.uk`,
    `DTSTAMP:${toIcsDateTime(new Date())}`,
    `DTSTART:${toIcsDateTime(start)}`,
    `DTEND:${toIcsDateTime(end)}`,
    `SUMMARY:${escapeIcs(`Follow up with ${name}`)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs('Phone / Email follow-up')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(`Contact ${name} about their enquiry`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

async function sendTelegramMessage(messageText) {
  if (!telegramBotToken || !telegramChatId) {
    return;
  }

  const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: messageText,
      parse_mode: 'HTML',
    }),
  });
}

app.post('/api/contact', async (req, res) => {
  const {
    name,
    telephone,
    email,
    contact_method,
    preferred_contact_time,
    message,
    consent,
  } = req.body || {};

  if (!name || !telephone || !email || !contact_method || !message || !consent) {
    return res.status(400).json({
      success: false,
      message: 'Please complete all required fields and consent to the message being used.',
    });
  }

  if (contact_method === 'Telephone' && !preferred_contact_time) {
    return res.status(400).json({
      success: false,
      message: 'Please choose a preferred contact time when you want to be contacted by telephone.',
    });
  }

  if (!preferred_contact_time) {
    preferred_contact_time = 'No preference';
  }

  const fromEmail = process.env.EMAIL_FROM;
  const normalizedPassword = String(process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '');
  const toEmail = (process.env.EMAIL_TO || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (!fromEmail || !toEmail.length || !normalizedPassword) {
    return res.status(500).json({
      success: false,
      message: 'Email configuration is missing on the server.',
    });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: fromEmail,
      pass: normalizedPassword,
    },
  });

  const calendarInvite = buildFollowUpInvite({
    name,
    telephone,
    email,
    contactMethod: contact_method,
    preferredContactTime: preferred_contact_time,
  });

  const mailOptions = {
    from: `Todd Podiatry Contact Form <${fromEmail}>`,
    to: toEmail,
    replyTo: email,
    subject: `New enquiry from ${name}`,
    text: [
      `Name: ${name}`,
      `Telephone: ${telephone}`,
      `Email: ${email}`,
      `Preferred contact method: ${contact_method}`,
      `Preferred contact time: ${preferred_contact_time || 'Not specified'}`,
      '',
      'Message:',
      message,
      '',
      'Consent given: Yes',
      '',
      'Calendar reminder attached: follow up with this patient.',
    ].join('\n'),
    attachments: [
      {
        filename: 'todd-podiatry-follow-up.ics',
        content: calendarInvite,
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);

    const telegramMessage = [
      '<b>New Todd Podiatry enquiry</b>',
      `Name: ${name}`,
      `Telephone: ${telephone}`,
      `Email: ${email}`,
      `Preferred contact method: ${contact_method}`,
      `Preferred contact time: ${preferred_contact_time || 'Not specified'}`,
      '',
      `<b>Message:</b> ${message.replace(/\n/g, ' ')}`,
    ].join('\n');

    try {
      await sendTelegramMessage(telegramMessage);
    } catch (telegramError) {
      console.error('Telegram send failed:', telegramError);
    }

    return res.json({ success: true, message: 'Your enquiry has been sent successfully.' });
  } catch (error) {
    console.error('Email send failed:', error);
    return res.status(500).json({
      success: false,
      message: 'The form could not be sent at the moment. Please try again later.',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Todd Podiatry server running on http://localhost:${PORT}`);
});
