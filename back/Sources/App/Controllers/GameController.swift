import Fluent
import Vapor

struct GameController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let games = routes.grouped("games")
        games.get(use: index)
        games.post(use: create)
        games.get(":gameID", use: show)
        games.put(":gameID", use: update) //Pour la phase 3, déclaration de la route pour le PUT (modifier)
        games.delete(":gameID", use: delete) //Pour la phase 3, décalration de la route pour le DELETE (supprimer)
    }

    @Sendable
    func index(req: Request) async throws -> [GameDTO] { // Phase 3 (FEAT-06) : Récupère la liste des jeux avec filtres combinables et facultatifs (?q=...&players=...&maxDuration=...)
        
        var query = Game.query(on: req.db).with(\.$loans)
        
        // On filtre par titre (q) : recherche partielle insensible à la casse si le paramètre n'est pas vide
        if let q = req.query[String.self, at: "q"], !q.trimmingCharacters(in: .whitespaces).isEmpty {
            query = query.filter(\.$title, .custom("LIKE"), "%\(q)%")
        }
        if let playersRaw = req.query[String.self, at: "players"] { // Filtre par nombre de joueurs (players) : doit être un entier strictement positif (> 0)
            guard let players = Int(playersRaw), players > 0 else {
                throw Abort(.badRequest, reason: "players must be a positive integer")
            }
            query = query
                .filter(\.$minPlayers <= players)
                .filter(\.$maxPlayers >= players)
        }
        if let maxDurationRaw = req.query[String.self, at: "maxDuration"] { // Filtre par durée maximale en minutes (maxDuration) : doit être un entier strictement positif (> 0)
            guard let maxDuration = Int(maxDurationRaw), maxDuration > 0 else {
                throw Abort(.badRequest, reason: "maxDuration must be a positive integer")
            }
            query = query.filter(\.$durationMinutes <= maxDuration)
        }
        // Pour la phase 3 (FEAT-07) : Validation du filtre optionnel de disponibilité (?available=true ou false)
        var availableFilter: Bool? = nil
        if let availableRaw = req.query[String.self, at: "available"] {
            guard let valueBool = Bool(availableRaw) else {
                throw Abort(.badRequest, reason: "available must be 'true' or 'false'")
            }
            availableFilter = valueBool
        }
        
        let games = try await query.all()
        
        var results = games.map { $0.toDTO() }

        if let availableFilter {
            results = results.filter { $0.isAvailable == availableFilter }
        }

        return results
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        try CreateGameDTO.validate(content: req)
        let dto = try req.content.decode(CreateGameDTO.self)
        try dto.ensureConsistentPlayerCount()

        let game = dto.toModel()
        try await game.save(on: req.db)
        return try await game.toDTO().encodeResponse(status: .created, for: req) //pour corriger le 1er bug, ajouter le status: .created pour forcer le statut HTTP 201 Created au lieu de HTTP 200 par défaut
    }

    @Sendable
    func show(req: Request) async throws -> GameDTO {
        try await findGame(req).toDTO()
    }

    private func findGame(_ req: Request) async throws -> Game {
        guard let gameID = req.parameters.get("gameID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid game id")
        }
        guard let game = try await Game.query(on: req.db)
            .filter(\.$id == gameID)
            .with(\.$loans)
            .first()
        else {
            throw Abort(.notFound, reason: "Game not found") //Pour le 1er bug, changer l'erreur serveur .internalServerError par une erreur cas métier : élément introuvable 404 Not Found (.notFound)
        }
        return game
    }
    
    @Sendable
    func update(req: Request) async throws -> GameDTO { //Fonction ajouter pour la phase 3 :
        //On retrouve le jeu grâce à l'ID dans l'URL (si l'ID n'existe pas, findGame renvoie une 404 tout seul)
        let game = try await findGame(req) //On retrouve le jeu grâce à l'ID dans l'URL (si l'ID n'existe pas, findGame renvoie une 404 tout seul)
        
        try CreateGameDTO.validate(content: req)
        let updatedDTO = try req.content.decode(CreateGameDTO.self)
        try updatedDTO.ensureConsistentPlayerCount()
        
        //Ici, on met à jour les propriétés du jeu avec les nouvelles valeurs
        game.title = updatedDTO.title
        game.minPlayers = updatedDTO.minPlayers
        game.maxPlayers = updatedDTO.maxPlayers
        game.durationMinutes = updatedDTO.durationMinutes
        
        try await game.save(on: req.db)
        
        return game.toDTO()
    }
    
    @Sendable
    func delete(req: Request) async throws -> HTTPStatus { //Fonction ajouter pour la phase 3 :
        let game = try await findGame(req)
        
        try await game.$loans.load(on: req.db) // ici on vérifie s'il y'a des emprunts lié au game qu'on souhaite supprimé par la suite
            if !game.loans.isEmpty {
                throw Abort(.badRequest, reason: "Impossible de supprimer ce jeu car il possède des emprunts.") //Si la condition n'est pas vérifié (des emprunts sont liés au jeu) alors erreur HTTP code 400 Bad Request (pour éviter l'erreur serveur 500)
            }
        
        try await game.delete(on: req.db)
        
        return .noContent // ici, on retourne un statut HTTP 204 No Content
    }
}
