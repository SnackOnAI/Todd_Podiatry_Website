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

  const fromEmail = process.env.EMAIL_FROM;
  const toEmail = process.env.EMAIL_TO;

  if (!fromEmail || !toEmail) {
    return res.status(500).json({
      success: false,
      message: 'Email configuration is missing on the server.',
    });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: fromEmail,
      pass: process.env.EMAIL_PASSWORD,
    },
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
    ].join('\n'),
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
