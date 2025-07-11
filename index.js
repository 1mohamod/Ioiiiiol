const { Client, GatewayIntentBits, Collection, InteractionType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const quizQuestions = require("./quizQuestions.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	if ("data" in command && "execute" in command) {
		client.commands.set(command.data.name, command);
	} else {
		console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
	}
}

// Store quiz state for each user: { userId: { currentQuestionIndex: 0, errorCount: 0, ticketChannelId: "" } }
const userQuizState = new Map();

client.once("ready", () => {
	console.log("Royal City Bot is Ready!");
});

client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: "There was an error while executing this command!", ephemeral: true });
            } else {
                await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
            }
        }
    } else if (interaction.isButton()) {
        if (interaction.customId === "start_activation_quiz") {
            const guild = interaction.guild;
            const member = interaction.member;

            const existingChannel = guild.channels.cache.find(c =>
                c.name === `ticket-${member.id}` && c.type === ChannelType.GuildText
            );

            if (existingChannel) {
                await interaction.reply({ content: `لديك تكت مفتوح بالفعل: ${existingChannel}. يرجى إكمال الاختبار هناك أو إغلاق التكت الحالي.`, ephemeral: true });
                return;
            }

            try {
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${member.id}`,
                    type: ChannelType.GuildText,
                    parent: null, // You might want to set a category ID here
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: member.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                        },
                        // Add roles for staff/admins who should see tickets
                        // Example: { id: 'YOUR_STAFF_ROLE_ID', allow: [PermissionsBitField.Flags.ViewChannel] },
                    ],
                });

                await interaction.reply({ content: `تم إنشاء تكت خاص بك هنا: ${ticketChannel}. يرجى التوجه إليه لإكمال الاختبار.`, ephemeral: true });

                // Initialize quiz state for the user
                userQuizState.set(member.id, { currentQuestionIndex: 0, errorCount: 0, ticketChannelId: ticketChannel.id });

                const { Modal, TextInputBuilder, TextInputStyle } = require("discord.js");

                const modal = new Modal()
                    .setCustomId("personal_questions_modal")
                    .setTitle("أسئلة التفعيل الشخصية");

                const nameInput = new TextInputBuilder()
                    .setCustomId("name_input")
                    .setLabel("ما اسمك؟")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const ageInput = new TextInputBuilder()
                    .setCustomId("age_input")
                    .setLabel("كم عمرك؟")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                
                const psnIdInput = new TextInputBuilder()
                    .setCustomId("psn_id_input")
                    .setLabel("ما هو ايديك (سوني)؟")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const ghostCityInput = new TextInputBuilder()
                    .setCustomId("ghost_city_input")
                    .setLabel("وين شفت قوست ستي العظيم؟")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true);

                const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
                const secondActionRow = new ActionRowBuilder().addComponents(ageInput);
                const thirdActionRow = new ActionRowBuilder().addComponents(psnIdInput);
                const fourthActionRow = new ActionRowBuilder().addComponents(ghostCityInput);

                modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);

                await ticketChannel.send({ content: "يرجى الإجابة على الأسئلة التالية:", ephemeral: false });
                await interaction.showModal(modal);

            } catch (error) {
                console.error("Error creating ticket or showing modal:", error);
                await interaction.reply({ content: "حدث خطأ أثناء إنشاء التكت أو بدء الاختبار. يرجى المحاولة مرة أخرى لاحقًا.", ephemeral: true });
            }
        } else if (interaction.customId.startsWith("rp_q")) {
            const userId = interaction.user.id;
            const quizState = userQuizState.get(userId);

            if (!quizState || quizState.ticketChannelId !== interaction.channel.id) {
                await interaction.reply({ content: "هذا الزر ليس مخصصًا لك أو أنك لست في تكت الاختبار الصحيح.", ephemeral: true });
                return;
            }

            const questionIndex = quizState.currentQuestionIndex - 1; // Current question was sent, so index is one less
            const currentQuestion = quizQuestions[questionIndex];
            const userAnswer = interaction.customId.endsWith("_true");

            if (userAnswer !== currentQuestion.answer) {
                quizState.errorCount++;
                await interaction.reply({ content: `إجابة خاطئة! عدد الأخطاء: ${quizState.errorCount}/5`, ephemeral: true });
            } else {
                await interaction.reply({ content: "إجابة صحيحة!", ephemeral: true });
            }

            if (quizState.errorCount >= 5) {
                // Failed the quiz
                await interaction.channel.send({
                    content: `لقد تجاوزت الحد الأقصى من الأخطاء (${quizState.errorCount}/5). لقد فشلت في الاختبار.\nيرجى الضغط على الزر أدناه لإعادة المحاولة.`, ephemeral: false
                });
                const activateButton = new ButtonBuilder()
                    .setCustomId("start_activation_quiz")
                    .setLabel("بدء اختبار التفعيل")
                    .setStyle(ButtonStyle.Primary);
                const row = new ActionRowBuilder().addComponents(activateButton);
                await interaction.channel.send({ components: [row] });
                userQuizState.delete(userId); // Reset quiz state
                return;
            }

            // Move to the next question
            if (quizState.currentQuestionIndex < quizQuestions.length) {
                sendNextRPQuestion(interaction.channel, userId);
            } else {
                // Quiz completed successfully
                await interaction.channel.send({
                    content: "**تم اجتياز الاختبار بنجاح! يرجى انتظار أحد الإداريين لمنحك الرتبة وتفعيلك.**", ephemeral: false
                });
                userQuizState.delete(userId); // Clear quiz state after completion
            }
        }
    } else if (interaction.type === InteractionType.ModalSubmit) {
        if (interaction.customId === "personal_questions_modal") {
            const userId = interaction.user.id;
            const quizState = userQuizState.get(userId);

            if (!quizState || quizState.ticketChannelId !== interaction.channel.id) {
                await interaction.reply({ content: "هذا النموذج ليس مخصصًا لك أو أنك لست في تكت الاختبار الصحيح.", ephemeral: true });
                return;
            }

            const name = interaction.fields.getTextInputValue("name_input");
            const age = interaction.fields.getTextInputValue("age_input");
            const psnId = interaction.fields.getTextInputValue("psn_id_input");
            const ghostCity = interaction.fields.getTextInputValue("ghost_city_input");

            await interaction.reply({
                content: `**إجاباتك الشخصية:**\nالاسم: ${name}\nالعمر: ${age}\nايدي السوني: ${psnId}\nأين رأيت قوست ستي: ${ghostCity}\n\nالآن لنبدأ أسئلة الصح والخطأ عن الرول بلاي.`, ephemeral: false
            });

            // Start RP questions
            sendNextRPQuestion(interaction.channel, userId);
        }
    }
});

async function sendNextRPQuestion(channel, userId) {
    const quizState = userQuizState.get(userId);
    if (!quizState) return;

    const currentQuestionIndex = quizState.currentQuestionIndex;

    if (currentQuestionIndex < quizQuestions.length) {
        const question = quizQuestions[currentQuestionIndex];

        const trueButton = new ButtonBuilder()
            .setCustomId(`${question.customId}_true`)
            .setLabel("صح")
            .setStyle(ButtonStyle.Success);

        const falseButton = new ButtonBuilder()
            .setCustomId(`${question.customId}_false`)
            .setLabel("خطأ")
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(trueButton, falseButton);

        await channel.send({
            content: `**السؤال ${currentQuestionIndex + 1}/${quizQuestions.length}:**\n${question.question}`,
            components: [row],
            ephemeral: false
        });
        quizState.currentQuestionIndex++;
    } else {
        // This case should ideally be handled by the button interaction logic
        // if all questions are answered correctly.
        // It's a fallback for unexpected flow.
        await channel.send({
            content: "**تم اجتياز الاختبار بنجاح! يرجى انتظار أحد الإداريين لمنحك الرتبة وتفعيلك.**", ephemeral: false
        });
        userQuizState.delete(userId);
    }
}

client.login(process.env.DISCORD_TOKEN);

