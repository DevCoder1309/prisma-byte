const express = require("express");
const { PrismaClient } = require("@prisma/client");
const app = express();
const port = 3000;
const prisma = new PrismaClient();
const bodyParser = require("body-parser");
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
const findOldestPrimary = (contacts) => {
  const primaries = contacts.filter((c) => c.linkPrecedence === "primary");
  return primaries.sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  )[0];
};

const getAllRelatedContacts = async (contactIds) => {
  const allRelated = await prisma.contact.findMany({
    where: {
      OR: [{ id: { in: contactIds } }, { linkedId: { in: contactIds } }],
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return allRelated;
};

app.get("/", async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

app.post("/identify", async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      return res
        .status(400)
        .json({ error: "Either email or phoneNumber is required" });
    }

    const existingByEmail = email
      ? await prisma.contact.findMany({
          where: { email },
        })
      : [];

    const existingByPhone = phoneNumber
      ? await prisma.contact.findMany({
          where: { phoneNumber },
        })
      : [];

    const allExistingContacts = [...existingByEmail, ...existingByPhone];
    const uniqueContactIds = [...new Set(allExistingContacts.map((c) => c.id))];

    if (uniqueContactIds.length === 0) {
      const newContact = await prisma.contact.create({
        data: {
          phoneNumber,
          email,
          linkedId: null,
          linkPrecedence: "primary",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      });

      return res.status(200).json({
        contact: {
          primaryContactId: newContact.id,
          emails: email ? [email] : [],
          phoneNumbers: phoneNumber ? [phoneNumber] : [],
          secondaryContactIds: [],
        },
      });
    }

    const allRelated = await getAllRelatedContacts(uniqueContactIds);

    const allRelatedIds = [
      ...new Set([
        ...allRelated.map((c) => c.id),
        ...allRelated.filter((c) => c.linkedId).map((c) => c.linkedId),
      ]),
    ];

    const completeContactSet = await getAllRelatedContacts(allRelatedIds);

    const hasEmailMatch = completeContactSet.some((c) => c.email === email);
    const hasPhoneMatch = completeContactSet.some(
      (c) => c.phoneNumber === phoneNumber
    );

    let shouldCreateNewContact = false;

    if (email && phoneNumber) {
      const contactsWithEmail = completeContactSet.filter(
        (c) => c.email === email
      );
      const contactsWithPhone = completeContactSet.filter(
        (c) => c.phoneNumber === phoneNumber
      );

      const emailClusterIds = new Set();
      const phoneClusterIds = new Set();

      contactsWithEmail.forEach((c) => {
        emailClusterIds.add(c.linkPrecedence === "primary" ? c.id : c.linkedId);
      });

      contactsWithPhone.forEach((c) => {
        phoneClusterIds.add(c.linkPrecedence === "primary" ? c.id : c.linkedId);
      });

      const hasOverlap = [...emailClusterIds].some((id) =>
        phoneClusterIds.has(id)
      );

      if (
        !hasOverlap &&
        contactsWithEmail.length > 0 &&
        contactsWithPhone.length > 0
      ) {
        const allPrimaries = completeContactSet.filter(
          (c) => c.linkPrecedence === "primary"
        );
        const oldestPrimary = findOldestPrimary(allPrimaries);

        const primariesToUpdate = allPrimaries.filter(
          (p) => p.id !== oldestPrimary.id
        );

        for (const primary of primariesToUpdate) {
          await prisma.contact.update({
            where: { id: primary.id },
            data: {
              linkPrecedence: "secondary",
              linkedId: oldestPrimary.id,
              updatedAt: new Date(),
            },
          });

          await prisma.contact.updateMany({
            where: { linkedId: primary.id },
            data: {
              linkedId: oldestPrimary.id,
              updatedAt: new Date(),
            },
          });
        }
      } else if (!hasEmailMatch || !hasPhoneMatch) {
        shouldCreateNewContact = true;
      }
    } else {
      if ((email && !hasEmailMatch) || (phoneNumber && !hasPhoneMatch)) {
        shouldCreateNewContact = true;
      }
    }

    if (shouldCreateNewContact) {
      const primaryContact = findOldestPrimary(completeContactSet);

      await prisma.contact.create({
        data: {
          phoneNumber,
          email,
          linkedId: primaryContact.id,
          linkPrecedence: "secondary",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      });
    }

    const finalContacts = await getAllRelatedContacts(allRelatedIds);
    const primaryContact = findOldestPrimary(finalContacts);

    const emailsSet = new Set();
    const phonesSet = new Set();
    const secondaryIds = [];

    finalContacts.forEach((contact) => {
      if (contact.email) emailsSet.add(contact.email);
      if (contact.phoneNumber) phonesSet.add(contact.phoneNumber);
      if (contact.linkPrecedence === "secondary") {
        secondaryIds.push(contact.id);
      }
    });

    const response = {
      contact: {
        primaryContactId: primaryContact.id,
        emails: Array.from(emailsSet),
        phoneNumbers: Array.from(phonesSet),
        secondaryContactIds: secondaryIds.sort((a, b) => a - b),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in /identify:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
