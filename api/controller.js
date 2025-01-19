const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require("crypto");
const OpenAI = require("openai");
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const uri = process.env.MONGO_DB_URI;
const client = new MongoClient(uri);
let db;

async function connectDB() {
  await client.connect();
  db = client.db("MessageTools"); // Nome do banco de dados
  console.log("Conectado ao MongoDB");
}

connectDB().catch(console.error);

const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
// Configurar para servir arquivos estáticos (frontend)
//app.use(express.static(path.join(__dirname, 'public')));

// Para analisar o corpo das requisições como JSON
app.use(express.json());

async function login(email, senha) {
    try {
        senha = crypto.createHash('sha256').update(senha).digest('hex');
        const idUsuario = crypto.createHash('sha256').update(email+senha).digest('hex');
        const usuario = await db.collection("usuarios").findOne({ idUsuario });
        if (usuario) {
            return usuario;
        } else {
            return null;
        }
    } catch (error) {
        console.error("Erro no login:", error);
        throw error;
    }
}

async function cadastro(email, senha, numero, tipos) {
    try {
        numero = formataNumero(numero);
        const emailExistente = await db.collection("usuarios").findOne({ email });
        const numeroExistente = await db.collection("usuarios").findOne({ numero });
        if (emailExistente || numeroExistente) {
            return null;
        }
        senha = crypto.createHash('sha256').update(senha).digest('hex');
        const dataAtual =  new Date();
        const idUsuario = crypto.createHash('sha256').update(email+senha).digest('hex');
        let verificaNumeros = new Set();
        let assuntos = new Set;
        const classificacoes = {};
        const historico = {};
        const conectado = false;
        for(let nivel in tipos){
            classificacoes[nivel] = {};
            for(let i = 0; i < tipos[nivel].numeros.length; i++){
                tipos[nivel].numeros[i] = formataNumero(tipos[nivel].numeros[i]);
                verificaNumeros.add(tipos[nivel].numeros[i]);
            }
            if(tipos[nivel].tipoClassificacao == 1){
                for(let i = 0; i < tipos[nivel].assuntos.length; i++){
                    tipos[nivel].assuntos[i] = tipos[nivel].assuntos[i].toLowerCase();
                    assuntos.add(tipos[nivel].assuntos[i]);
                }
            }
        }
        for(const numero of verificaNumeros){
            historico[numero] = {};
        }
        verificaNumeros = Array.from(verificaNumeros);
        assuntos = Array.from(assuntos);
        const novoUsuario = {
            idUsuario,
            email,
            senha,
            numero,
            tipos,
            verificaNumeros,
            assuntos,
            classificacoes,
            historico,
            conectado,
            criadoEm: dataAtual,
        };
        await db.collection("usuarios").insertOne(novoUsuario);
        return novoUsuario;
    } catch (error) {
        console.error("Erro no cadastro:", error);
        throw error;
    }
}

function formataNumero(numero){
    numero = numero.replace(/[^0-9]/g, '');
    if(numero.length == 13){
        return numero.slice(0, 4) + numero.slice(-8) + "@c.us";
    }
    if(numero.length == 12){
        return numero + "@c.us";
    }
    if(numero.length == 11){
        return "55" + numero.slice(0, 2) + numero.slice(-8) + "@c.us";
    }
    if(numero.length == 10){
        return "55" + numero + "@c.us";
    }
    if(numero.length == 9){
        return "5586" + numero.slice(-8) + "@c.us";
    }
    if(numero.length == 8){
        return "5586" + numero + "@c.us";
    }
    return "";
}

async function configurarTipos(idUsuario, tipos){
    let usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario });
    if(usuario == null){
        return null;
    }
    const historico = usuario.historico;
    let verificaNumeros = new Set();
    let assuntos = new Set;
    const classificacoes = {};
    for(let nivel in tipos){
        classificacoes[nivel] = {};
        for(let i = 0; i < tipos[nivel].numeros.length; i++){
            tipos[nivel].numeros[i] = formataNumero(tipos[nivel].numeros[i]);
            verificaNumeros.add(tipos[nivel].numeros[i]);
        }
        if(tipos[nivel].tipoClassificacao == 1){
            for(let i = 0; i < tipos[nivel].assuntos.length; i++){
                tipos[nivel].assuntos[i] = tipos[nivel].assuntos[i].toLowerCase();
                assuntos.add(tipos[nivel].assuntos[i]);
            }
        }
    }
    verificaNumeros = Array.from(verificaNumeros);
    assuntos = Array.from(assuntos);
    for(const numero in historico){
        for(const registro in historico[numero]){
            historico[numero][registro].valido = false;
        }
    }
    for(const numero of verificaNumeros){
        if(Object.keys(historico).indexOf(numero)<0){
            historico[numero] = {};
        }
    }

    const editaTipos = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { tipos: tipos}});
    const editaVerificaNumeros = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { verificaNumeros: verificaNumeros}});
    const editaAssuntos = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { assuntos: assuntos}});
    const editaClassificacoes = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { classificacoes: classificacoes}});
    const editaHistorico = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { historico: historico}});
    usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario });
    return usuario;
}

function criaHash(numero){
    const horaDataAtual = new Date().toISOString(); 
    const stringHash = horaDataAtual + numero;
    return crypto.createHash('sha256').update(stringHash).digest('hex');
}

async function recebeMensagem(message){
    const numeroUsuario = message.to;
    const usuario = await db.collection("usuarios").findOne({ numero: numeroUsuario });
    if(usuario == null){
        return false;
    }
    const numeroRemetente = message.from;
    const nomeRemetente =  message.sender.name;
    const mensagem = message.body;
    console.log(mensagem);
    const tipos = usuario.tipos;
    let classificacoes = usuario.classificacoes;
    const idUsuario = usuario.idUsuario;
    const verificaNumeros = usuario.verificaNumeros;
    if(verificaNumeros.includes(numeroRemetente)){
        let resultado = [];
        if(usuario.assuntos != []){
            const assuntosUsuario = usuario.assuntos.join(", ").toLowerCase();
            const mensagemChatGpt = 'A mensagem "' + mensagem + '" tem relação com algum dos assuntos a seguir: ' + assuntosUsuario + '? Caso não a mensagem não tenha relação direta com nenhum assunto responda com null. Resposta sem . e com assuntos separados por ,';
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo-0125",
                messages: [
                    {"role": "user", "content": mensagemChatGpt},
                ],
            });
            let resposta = completion.choices[0].message.content;
            resposta = resposta.replace(/\s/g, '');
            resultado = resposta.split(",");
            console.log(resultado);
        }
        for(let nivel in tipos){
            let numeros = tipos[nivel].numeros;
            if(numeros.includes(numeroRemetente)){
                let estaNivel = false;
                if(tipos[nivel].tipoClassificacao == 0){
                    const listaPalavras = tipos[nivel].palavrasChave;
                    for(let i = 0; i < listaPalavras.length; i++){
                        if(((mensagem.toLowerCase()).split(" ")).indexOf(listaPalavras[i]) >= 0){
                            estaNivel = true;
                            break;
                        }
                    }
                }else if(tipos[nivel].tipoClassificacao == 1){
                    estaNivel = tipos[nivel].assuntos.some(element => resultado.includes(element.toLowerCase()));
                }
                if(estaNivel){
                    if(!(numeroRemetente in classificacoes[nivel])){
                        classificacoes[nivel][numeroRemetente] = {
                            nome: nomeRemetente,
                            mensagens: []
                        };
                    }
                    classificacoes[nivel][numeroRemetente].mensagens.push(mensagem);
                    const edicao = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { classificacoes: classificacoes}});
                }
            }
        }
    }
    return true;
}

function mostraNumero(numero){
    let codigoPais = numero.slice(0, 2);
    let ddd = numero.slice(2, 4);
    let segundaParte = numero.slice(4, 8);
    let terceiraParte = numero.slice(8, 12);
    return `+${codigoPais} (${ddd}) 9 ${segundaParte}-${terceiraParte}`;
}

function formatarData (data){
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0'); // Janeiro é 0!
    const ano = data.getFullYear();
    const hora = String(data.getHours()).padStart(2, '0');
    const minuto = String(data.getMinutes()).padStart(2, '0');
  
    return `${hora}:${minuto} ${dia}/${mes}/${ano}`;
};

async function nivel(idUsuario, nomeNivel){
    const usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario});
    if(usuario == null){
        return null;
    }
    const tipos = usuario.tipos;
    const classificacoes = usuario.classificacoes;
    let resposta = {};
    resposta["nomeNivel"] = nomeNivel;
    if(tipos[nomeNivel].tipoClassificacao == 0){
        resposta["palavrasChave"] = tipos[nomeNivel].palavrasChave;
    } else if(tipos.tipoClassificacao == 1){
        resposta["assuntos"] = tipos[nomeNivel].assuntos;
    }
    resposta["numeros"] = tipos[nomeNivel].numeros;
    resposta["mensagens"] = classificacoes[nomeNivel];
    return resposta;
}

async function niveisUsuario(idUsuario){
    const usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario});
    if(usuario == null){
        return null;
    }
    const tipos = usuario.tipos;
    let resposta = {};
    resposta["niveis"] = Object.keys(tipos);
    return resposta;
}

async function resolver(idUsuario, nomeNivel, resolverNumero){
    const usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario });
    if(usuario == null){
        return false;
    }
    const historico = usuario.historico;
    const classificacoes = usuario.classificacoes;
    const horaDataAtual = new Date().toISOString();
    const resolverMensagens = classificacoes[nomeNivel][resolverNumero].mensagens;
    const nomeRemetente = classificacoes[nomeNivel][resolverNumero].nome;
    historico[resolverNumero][horaDataAtual] = {
        nomeNivel: nomeNivel,
        nomeRemetente: nomeRemetente,
        mensagens: resolverMensagens,
        valido: true
    };
    const edicao = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { historico: historico}});
    delete classificacoes[nomeNivel][resolverNumero];
    const exclusao = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { classificacoes: classificacoes}});
    return true;
}

async function historicoUsuario(idUsuario){
    const usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario });
    if(usuario == null){
        return null;
    }
    return usuario.historico;
}

async function voltar(idUsuario, numeroResolvido, resolvidoEm){
    const usuario = await db.collection("usuarios").findOne({ idUsuario : idUsuario });
    if(usuario == null){
        return false;
    }
    const historico = usuario.historico;
    const classificacoes = usuario.classificacoes;

    const mensagens = historico[numeroResolvido][resolvidoEm].mensagens;
    const nomeNivel = historico[numeroResolvido][resolvidoEm].nomeNivel;
    const nomeRemetente = historico[numeroResolvido][resolvidoEm].nomeRemetente;
    classificacoes[nomeNivel][numeroResolvido] = {
        nome: nomeRemetente,
        mensagens: mensagens
    };
    const edicao = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { classificacoes: classificacoes}});
    delete historico[numeroResolvido][resolvidoEm];
    const exclusao = await db.collection("usuarios").updateOne({idUsuario: idUsuario}, { $set: { historico: historico}});
    return true;
}

app.post("/api/login", async (req, res) =>{
    if (!db) {
        // Caso a conexão com o MongoDB não tenha sido estabelecida
        return res.status(500).json({
            success: false,
            email: req.body.email,
            senha: req.body.senha,
            mongoDB: process.env.MONGO_DB_URI,
            message: "Banco de dados não conectado.",
        });
    }
    try{
        const usuario = await login(req.body.email, req.body.senha);
        if (usuario != null) {
            res.status(201).json({ 
                success: true, 
                email: req.body.email,
                senha: req.body.senha,
                mongoDB: process.env.MONGO_DB_URI,
                message: "Usuário logou com sucesso!", 
                usuario 
            });
        } else {
            res.status(401).json({ 
                success: false, 
                email: req.body.email,
                senha: req.body.senha,
                mongoDB: process.env.MONGO_DB_URI,
                message: "Email ou senha incorretos." 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Erro ao fazer login.", 
            email: req.body.email,
            senha: req.body.senha,
            mongoDB: process.env.MONGO_DB_URI,
            error: error.message 
        });
    }
});

app.post("/api/cadastro", async (req, res) => {
    try {
        const usuario = await cadastro(req.body.email, req.body.senha, req.body.numero, req.body.tipos);
        if (usuario != null) {
            res.status(201).json({ 
                success: true, 
                message: "Usuário cadastrado com sucesso!", 
                usuario 
            });
        } else {
            res.status(401).json({ 
                success: false, 
                message: "Email e/ou número já cadastrado." 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Erro ao fazer cadastro.", 
            error: error.message 
        });
    }
});

app.post("/api/configurarTipos", async (req, res) =>{
    try{
        const usuario = await configurarTipos(req.body.idUsuario, req.body.tipos);
        if (usuario) {
            res.status(201).json({ 
                success: true, 
                message: "Tipos configurados com sucesso!",
                usuario 
            });
        } else {
            res.status(401).json({ 
                success: false, 
                message: "Usuário não encontrado" 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Erro ao configurar tipos.", 
            error: error.message 
        });
    }
});

app.post("/api/recebeMensagem", async (req, res) =>{
    recebeMensagem(req.body.message);
});

app.post("/api/nivel", async (req, res) =>{
    const resposta = await nivel(req.body.idUsuario, req.body.nomeNivel);
    res.status(201).json({ 
        success: true,  
        resposta 
    });
});

app.post("/api/niveisUsuario", async (req, res) =>{
    const resposta = await niveisUsuario(req.body.idUsuario);
    res.status(201).json({ 
        success: true,  
        resposta 
    });
});

app.post("/api/resolver", async (req, res) =>{
    try{
        const usuario = await resolver(req.body.idUsuario, req.body.nomeNivel, req.body.resolverNumero);
        if (usuario) {
            res.status(201).json({ 
                success: true, 
                message: "Contato resolvido com sucesso!", 
            });
        } else {
            res.status(401).json({ 
                success: false, 
                message: "Contato não encontrado" 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Erro ao resolver contato.", 
            error: error.message 
        });
    }
});

app.post("/api/historicoUsuario", async (req, res) =>{
    const resposta = await historicoUsuario(req.body.idUsuario);
    res.status(201).json({ 
        success: true, 
        resposta 
    });
});

app.post("/api/voltar", async (req, res) =>{
    try{
        const resposta = voltar(req.body.idUsuario, req.body.numeroResolvido, req.body.resolvidoEm);
        if (resposta) {
            res.status(201).json({ 
                success: true, 
                message: "Mensagens retornadas com sucesso!", 
            });
        } else {
            res.status(401).json({ 
                success: false, 
                message: "Usuário não encontrado" 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Erro ao retornar mensagens.", 
            error: error.message 
        });
    }
});

let port = process.env.PORT || 3000;
app.get('/api/', (req, res) => {
    res.send("Meu servidor ta OK");
});

app.listen(port, (req, res)=>{
    console.log("Servidor Rodando.");
})