import React, { useState, useEffect, useRef } from 'react';
import './Chatbox.css';
import OpenAI from "openai";
import { getDocument, GlobalWorkerOptions  } from 'pdfjs-dist';
import * as XLSX from 'xlsx';

const openai = new OpenAI({ apiKey: process.env.REACT_APP_OPENAI_API_KEY, dangerouslyAllowBrowser: true });
const COMPLETIONS_MODEL = "gpt-3.5-turbo";
const EMBEDDINGS_MODEL = "text-embedding-ada-002";
const EMBEDDINGS_FILENAME = "ChatData.xlsx";
GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.269/pdf.worker.min.mjs`;
const embeddingsDict = {};

const Chatbox = () => {
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState([]);
  const chatBoxRef = useRef(null);

  useEffect(() => {
    // Scroll to the bottom of the chat box when messages change
    chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async () => {
    if (userInput.trim() === '') return;

    const userMessage = { text: userInput, sender: 'user' };
    setMessages([...messages, userMessage]);
    setUserInput('');

    try {

      var finalPrompt = userInput;

      if (Object.keys(embeddingsDict).length !== 0)
      {
        const embeddedUserInput = createEmbedding(userInput);

        // create map of text against similarity score
        const similarityScoreHash = getSimilarityScore(
          embeddingsDict,
          embeddedUserInput
        );

        // get text (i.e. key) from score map that has highest similarity score
        const textWithHighestScore = Object.keys(similarityScoreHash).reduce(
          (a, b) => (similarityScoreHash[a] > similarityScoreHash[b] ? a : b)
        );

        // build final prompt
        finalPrompt = `
          Info: ${textWithHighestScore}
          Question: ${userInput}
          Answer:
        `;

        console.log(finalPrompt);
      }      

      // Make an API call to your backend with the user input
      const completion = await openai.chat.completions.create({
        messages: [{ role: "system", content: finalPrompt }],
        model: COMPLETIONS_MODEL,
      })

      console.log(completion);

      // Display the bot's response
      const botResponse = completion.choices[0].message.content;
      setMessages([...messages, userMessage, { text: botResponse, sender: 'bot' }]);
    } catch (error) {
      console.error('Error fetching response from the server:', error);
    }
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
    }
  };

  const createEmbedding = async (data) => {
    const embedding = await openai.embeddings.create({
      model: EMBEDDINGS_MODEL,
      input: data,
      encoding_format: "float",
    });
    
    return JSON.stringify(embedding.data[0].embedding);
    //return [0.1, 0.2, 0.3];
  }

  const handlePdfFileChange = async (event) => {
    const files = event.target.files;

    if (files.length > 0) {

      console.log("Processing files");
      
      try {
        for (const file of files) {
          console.log(file.name);
          const fileReader = new FileReader();

          fileReader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            const text = await extractTextFromPdf(arrayBuffer);
            const modifiedText = text.replace(/\n/g, ' ');

            // Use modifiedText as needed (e.g., display in the chat, send to the backend)
            console.log('Modified Text:', modifiedText);

            embeddingsDict[modifiedText] = await createEmbedding(modifiedText);
            console.log(embeddingsDict);
          };

          fileReader.readAsArrayBuffer(file);
        }
      } catch (error) {
        console.error('Error reading the file:', error);
      }
    }
  };

  const extractTextFromPdf = async (arrayBuffer) => {
    const pdf = await getDocument(arrayBuffer).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => item.str).join(' ');
    return text;
  };

  const handleExcelFileChange = async (event) => {
    const file = event.target.files[0];

    if (file) {
      try {
        const arrayBuffer = await readFile(file);
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // Read all sheets and store data in a dictionary
        workbook.SheetNames.forEach((sheetName) => {
          const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: ['Key', 'Value'] });

          sheetData.forEach((row) => {
            embeddingsDict[row.Key] = row.Value;
          });
        });

        console.log(embeddingsDict);
      } catch (error) {
        console.error('Error reading or processing the file:', error);
      }
    }
  };

  const readFile = (file) => {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();

      fileReader.onload = (e) => resolve(e.target.result);
      fileReader.onerror = (e) => reject(e.target.error);

      fileReader.readAsArrayBuffer(file);
    });
  };

  const saveEmbeddings = () => {

    // Convert the dictionary to a JSON object and call saveToExcelFile
    const jsonObjectToAppend = JSON.stringify(embeddingsDict);
    console.log(embeddingsDict);
    console.log(jsonObjectToAppend);
    saveToExcelFile(JSON.parse(jsonObjectToAppend));
  };

  const saveToExcelFile = (dataObject) => {

    try {
      // Read existing Excel file or create a new one if it doesn't exist
      const workbook = XLSX.utils.book_new();

      // Get the existing worksheet or create a new one
      const worksheetName = 'ChatData';
      const worksheet = XLSX.utils.json_to_sheet([]);

      // Convert the dataObject to an array of rows
      const rows = Object.entries(dataObject).map(([key, value]) => ({ Key: key, Value: value }));

      // Append the new rows to the existing worksheet
      XLSX.utils.sheet_add_json(worksheet, rows, { header: ['Key', 'Value'], skipHeader: true, origin: -1 });

      // Update the workbook with the modified worksheet
      workbook.Sheets[worksheetName] = worksheet;
      XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);

      // Convert the workbook to a binary Excel file
      const excelBinary = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

      const blob = new Blob([new Uint8Array(excelBinary)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = EMBEDDINGS_FILENAME;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    catch (error) {
      console.error('Error saving embeddings to Excel file:', error);
    }
  };

  function cosineSimilarity(A, B) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < A.length; i++) {
      dotProduct += A[i] * B[i];
      normA += A[i] * A[i];
      normB += B[i] * B[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    return dotProduct / (normA * normB);
  }
  
  function getSimilarityScore(embeddingsHash, promptEmbedding) {
    const similarityScoreHash = {};
    Object.keys(embeddingsHash).forEach((text) => {
      console.log(promptEmbedding);
      console.log(embeddingsHash[text]);
      similarityScoreHash[text] = cosineSimilarity(
        promptEmbedding,
        JSON.parse(embeddingsHash[text])
      );
    });
    return similarityScoreHash;
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>Context-aware AI Chatbot</h2>
      </div>
      <div className="title">Select files to set context</div>
      <input className="input" type="file" onChange={handlePdfFileChange} accept=".pdf" multiple/>
      <div className="title">Select the embeddings file</div>
      <input className="input" type="file" onChange={handleExcelFileChange} accept=".xlsx" />
      <button className="input" onClick={saveEmbeddings} style={{float: 'right'}}>Save embeddings</button>
      <div className="chat-box" ref={chatBoxRef}>
        {messages.map((message, index) => (
          <div key={index} className={message.sender}>
            <strong>{message.sender === 'user' ? 'You' : 'AI Bot'}:</strong> {message.text}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
        />        
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
};

export default Chatbox;