import Fluent
import Vapor

struct MemberController: RouteCollection {
    func boot(routes: any RoutesBuilder) throws {
        let members = routes.grouped("members")
        members.get(use: index)
        members.post(use: create)
        members.get(":memberID", use: show)
        members.put(":memberID", use: update) //Pour la phase 3 (FEAT-02), déclaration de la route pour le PUT (modifier)
        members.delete(":memberID", use: delete) //Pour la phase 3 (FEAT-02), décalration de la route pour le DELETE (supprimer)
    }

    @Sendable
    func index(req: Request) async throws -> [MemberDTO] {
        try await Member.query(on: req.db).all().map { $0.toDTO() }
    }

    @Sendable
    func create(req: Request) async throws -> Response {
        try CreateMemberDTO.validate(content: req)
        let dto = try req.content.decode(CreateMemberDTO.self)

        let emailTaken = try await Member.query(on: req.db)
            .filter(\.$email == dto.email)
            .count() > 0
        guard !emailTaken else {
            throw Abort(.conflict, reason: "A member with this email already exists")
        }

        let member = dto.toModel()
        try await member.save(on: req.db)
        return try await member.toDTO().encodeResponse(status: .created, for: req)
    }

    @Sendable
    func show(req: Request) async throws -> MemberDTO {
        let member = try await findMember(req)
        return member.toDTO()
    }
    
    private func findMember(_ req: Request) async throws -> Member { // Fonction ajouter pour la phase 3 (FEAT-02) afin d'allèger la fonction show
        guard let memberID = req.parameters.get("memberID", as: UUID.self) else {
            throw Abort(.badRequest, reason: "Invalid member id")
        }
        guard let member = try await Member.query(on: req.db)
            .filter(\.$id == memberID)
            .with(\.$loans)
            .first() else {
            throw Abort(.notFound, reason: "Member not found")
        }
        return member
    }
    
    @Sendable
    func update(req: Request) async throws -> MemberDTO { //Fonction ajouter pour la phase 3 (FETA-02):
        //On retrouve l'adhérent grâce à l'ID dans l'URL (si l'ID n'existe pas, findMember renvoie une 404 tout seul)
        let member = try await findMember(req) //On retrouve l'adhérent grâce à l'ID dans l'URL (si l'ID n'existe pas, findMember renvoie une 404 tout seul)
        
        try CreateMemberDTO.validate(content: req)
        let updatedDTO = try req.content.decode(CreateMemberDTO.self)
        
        let emailTaken = try await Member.query(on: req.db) // On vérifie si l'e-mail modifié appartient déjà à un·e autre adhérent·e en base et on exclut l'ID du membre actuel pour lui permettre de garder son propre e-mail sans conflit)
            .filter(\.$email == updatedDTO.email)
            .filter(\.$id != member.id!)
            .count() > 0
        guard !emailTaken else {
            throw Abort(.conflict, reason: "A member with this email already exists")
        }
        
        //Ici, on met à jour les propriétés de l'adhérent avec les nouvelles valeurs
        member.name = updatedDTO.name
        member.email = updatedDTO.email
        
        try await member.save(on: req.db)
        
        return member.toDTO()
    }
    
    @Sendable
    func delete(req: Request) async throws -> HTTPStatus {
        let member = try await findMember(req)
        
        try await member.$loans.load(on: req.db)
        if !member.loans.isEmpty {
            throw Abort(.badRequest, reason: "Impossible de supprimer cet adhérent car il possède des emprunts.")
        }
        
        try await member.delete(on: req.db)
        return .noContent
    }
    
}
